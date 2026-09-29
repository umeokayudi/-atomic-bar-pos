# Decisão de prontidão da migration

PRODUCTION = UNCHANGED

Não houve SQL em produção. Não houve deploy. Não houve merge.

O arquivo continua `sql/migration_final.sql`. Esta etapa não escreveu outra migration.

MIGRATION STATUS:
READY FOR REVIEW

Isso não é PRODUCTION READY. O banco real ainda tem verificação externa aberta, isolada abaixo. Nenhum passo da migration preenche esse buraco com hipótese.

## Por que não é NOT READY

A idempotência local passou de novo: catálogo legado vazio, catálogo com dados, segunda execução, e duplicata de `bar_pricing`. Não há `DROP TABLE`, `DELETE` de histórico nem backfill. As dependências conhecidas no repositório estão resolvidas: `pos_vendas` nasce antes do `ALTER` do piso, `my_supplier_ids` não exige a tabela antes de ela existir, e o `UPDATE` de `operational_day` ficou de fora. Conflitos de arquitetura estão escritos. As RLS novas foram relidas. Os testes locais passaram. O que falta não é adivinhado: está marcado como verificação externa.

## Verificação externa

BLOCKED / EXTERNAL VERIFICATION REQUIRED, detalhado em `docs/production-schema-evidence.md`:

- Policies e RLS reais de `vendas`, `pedidos`, `perfis` e `produtos`. O repositório não as tem. Nenhuma policy nova foi escrita para elas.
- Policies já existentes em `caixa_movimentos`, se houver.
- Duplicatas reais de `bar_pricing`. A ferramenta somente leitura é `scripts/checkBarPricingDuplicates.mjs` (`npm run check:bar-pricing`). Ela não escolhe linha e não altera dados. Sem `BAR_PRICING_CHECK_URL` ela não conecta. Host `supabase.co` é recusado.

## LEGACY UNASSIGNED CASH MOVEMENTS

Linhas antigas de caixa podem ficar sem `bar_id` e sem `operational_day`. HQ continua autorizado a vê-las pela policy deste arquivo. Usuário de bar não. Não há backfill e não há leitura de `descricao` para inventar o bar.

## POS

| Caminho | Livro | Fechamento | Nesta migration |
|---|---|---|---|
| POS antigo | `vendas` | `create_order` em `atomic-bar-pos/src/pages/POS.jsx` | não instalado |
| Piso novo | `pos_vendas` | `pos_close_ticket` / `pos_close_with_charges` | instalado |
| Caixa clássico | `pos_vendas` direto | `commitPosSale` | não é o piso; não foi religado ao `create_order` |

`deduct_stock` e `create_order` continuam de fora. Os dois ainda usam `produtos.bar_id`. `create_order` ainda trata `vendas` como caixa.

## Piso: objeto, tela, SQL, necessidade, conflito

| Object | Frontend | SQL | Required by POS | Legacy conflict |
|---|---|---|---|---|
| `pos_vendas` | fechamento via RPC; `commitPosSale` grava direto no clássico | `CREATE` no preâmbulo, `ALTER` no piso | sim | ausente na nota de produção; não é `vendas` |
| `pos_vendas_itens` | só pelo RPC | mesmo preâmbulo | sim | sem `bar_id` na linha; o bar está na venda |
| `pos_tickets` | `pos_load_ticket` | `sql/pos_floor.sql` | sim | não havia tabela |
| `pos_ticket_items` | `pos_ticket_item` | `sql/pos_floor.sql` | sim | não havia tabela |
| `bar_spaces` | `PosFloor` lê; `BarSpacesTab` grava | preâmbulo | sim | existência em produção UNKNOWN |
| `caixa_movimentos` | piso grava pelo RPC; JBM lê em `Cashflow.jsx` | colunas novas anuláveis e policy | sim | LEGACY UNASSIGNED CASH MOVEMENTS |
| `pos_idempotency` | a tela manda a chave; não lê a tabela | `sql/pos_floor.sql` | sim | não havia tabela |
| pagamento | `cash`, `card`, `credit`, `other` no RPC | `pos_vendas.metodo_pagamento` e uma entrada de caixa | sim | não copiar isso para `vendas` |
| taxas do cliente | `pos_bar_config`; `pos_close_with_charges` se o extra for maior que zero | `sql/pos_ux.sql` | sim, quando ligadas | a taxa de 3,78% já existente é custo de operadora, não este acréscimo |
| `create_order` | só o POS antigo | `sql/pos_sale_security.sql`, fora do arquivo | não | `produtos.bar_id` e `vendas` como caixa |
| `deduct_stock` | sem chamada no piso | fora do arquivo | não | baixa `produtos.estoque_atual` com `bar_id` |

O piso não foi ligado ao fluxo antigo para a migration passar.

## Payroll

FUTURE MIGRATION: coluna `break` no ponto, e tipo `transport` na folha. O ponto grava batida `in` / `out`. A folha soma os tipos que já existem. Os dois funcionam sem esses campos. Não entram neste arquivo.

## RLS novas

Relidas no SQL do repositório. Nenhuma usa `USING (true)`. `SECURITY DEFINER` declara `search_path`. Caixa e piso exigem `auth.uid()` em `pos_require_bar`. Tabelas com `bar_id` usam `user_can_access_bar` ou `user_can_manage_bar_staff`. HQ é `admin` ou `jbm` em `is_procurement_hq` / `is_jbm`. Supplier vê a própria fonte por `my_supplier_ids`. Funcionário lê a própria linha de `bar_employees` e o próprio ponto; escrita de cadastro é gerente, cliente do bar, ou HQ.

`vendas`, `pedidos`, `perfis`, `produtos`: BLOCKED / EXTERNAL VERIFICATION REQUIRED. Sem policy especulativa.

## Classificação da migration atual

| Migration Step | Classification | Reason |
|---|---|---|
| Parada de `bar_pricing` duplicado | SAFE WITH PRECHECK | Falha com `BLOCKED` e não apaga. A lista de ids é `scripts/checkBarPricingDuplicates.mjs` |
| `user_can_access_bar` inicial | SAFE | O corpo final, com suspensão, vem depois em `sql/bar_employees.sql` |
| `CREATE` de `pos_vendas` e `pos_vendas_itens` | SAFE | Nasce antes do `ALTER`. `IF NOT EXISTS` não reescreve uma tabela de outro formato; isso continua UNKNOWN se a tabela já existir |
| `drink_menu` e `bar_pricing` | SAFE WITH PRECHECK | Índice único só depois da parada de duplicata |
| `bar_spaces`, `bar_guests`, `bar_visits`, `time_clock` | SAFE | Objetos novos. `break` não é coluna |
| Colunas anuláveis em `caixa_movimentos` | SAFE | Sem `UPDATE`. LEGACY UNASSIGNED CASH MOVEMENTS |
| `ADD COLUMN` em `estoque_movimentos` | SAFE | `IF NOT EXISTS`. Sem backfill |
| `cast_members` / `cast_comissoes` | SAFE WITH PRECHECK | `CREATE IF NOT EXISTS` não corrige uma tabela antiga de outro formato. Existência em produção é UNKNOWN |
| Fulfillment e depois procurement | SAFE | Funções repetidas ficam com o corpo de `sql/procurement.sql`. Sem segundo catálogo |
| `sql/pos_floor.sql` sem o backfill | SAFE | Comanda, garrafa, idempotência, `pos_close_ticket` |
| Folha | SAFE | Sem tipo `transport`. FUTURE MIGRATION |
| `bar_employees` | SAFE | Título e status. `perfis` continua sendo o login |
| `sql/pos_ux.sql` | SAFE | Favoritos, IA e taxas. Depende de `pos_close_ticket`, que já foi criado |
| RLS das tabelas novas | SAFE | Revisada. Sem `USING (true)` |
| RLS de `caixa_movimentos` | SAFE WITH PRECHECK | Muda a visibilidade da linha sem bar. Policy prévia nessa tabela é UNKNOWN |
| `deduct_stock` e `create_order` | NOT NEEDED | Continuam incompatíveis. Ficam fora |
| `produtos.bar_id`, colunas de balcão em `vendas`, backfill de caixa | NOT NEEDED | Não fazem parte do arquivo |
| RLS de `vendas`, `pedidos`, `perfis`, `produtos` | BLOCKED | EXTERNAL VERIFICATION REQUIRED. Não escrever policy no escuro |
| `break` e `transport` | NOT NEEDED | FUTURE MIGRATION |

## Testes locais

Não validam produção.

- `npm run test:migration:pg`
- `npm run test:security`
- `npm run test:pos`
- `npm run test:procurement`
- `npm run test:employees`
- `npm run test:payroll`
- `npm run test:pos:pg` em banco local, não em Supabase
- `npm run build`

O resultado desta execução está no corpo da PR.
