# Auditoria da migration antes de executar

Migration designed but not executed on production.

`sql/migration_final.sql` não foi aplicado em `ojirgkqtqvugqktyuhem` nem no holding. Não houve deploy. O que foi executado foi só em bancos Postgres locais descartáveis (`migration_legacy_empty_9777`, `migration_legacy_data_9777`, `migration_pricing_dups_9777`), criados e apagáveis nesta máquina. O fixture `scripts/fixtures/legacy_schema.sql` reconstrói o catálogo que o repositório não cria. Não é um dump de produção.

Esta auditoria não chama a migration de production-ready. As policies reais de `vendas`, `pedidos`, `perfis` e `produtos` não estão no repositório. A separação KNOWN / UNKNOWN / INFERRED está em `docs/production-schema-evidence.md`. A decisão desta etapa está em `docs/migration-readiness-decision.md`.

## 1. Schema legado que o repositório realmente define

Não existe `CREATE TABLE` neste repositório para `perfis`, `produtos`, `vendas`, `vendas_itens`, `pedidos`, `pedidos_itens`, `fornecedores`, `estoque_movimentos`, `caixa_movimentos` nem `bars`. `pos_vendas` também não era criada por nenhum script até o preâmbulo de `sql/migration_final.sql`. PK, FK, índice, constraint, RLS e policy dessas tabelas em produção continuam desconhecidos. A lista abaixo é o que o código lê ou grava, mais o que a auditoria read-only anterior viu.

| Tabela | Colunas que o app ou a auditoria usam | PK / FK / índice / constraint no repositório | RLS / policy no repositório | Funções deste arquivo que dependem dela |
|---|---|---|---|---|
| `perfis` | `id`, `nome`, `email`, `role`, `bar_id`. `cargo`, `salario_hora`, `ativo`, `clock_pin_hash` são lidos com fallback e não foram vistos em produção | nenhum `CREATE`. `id` é tratado como `auth.uid()` | nenhuma | `user_can_access_bar`, `is_procurement_hq`, `is_jbm`, `is_payroll_hq`, `pos_require_bar`, `bar_employees_match_profile` |
| `produtos` | `id`, `nome`, `categoria`, `preco_venda`, `custo`, `ativo`, `estoque_atual`, `estoque_minimo`, `estoque_maximo`, `volume_ml`. Sem `bar_id` | nenhum `CREATE`. A migration só faz `ADD COLUMN IF NOT EXISTS volume_ml` | nenhuma | `pos_sealed_units` e o fechamento leem estoque em `estoque_movimentos`, não esta coluna. `deduct_stock` e `create_order` ficam de fora |
| `vendas` | `id`, `bar_id`, `data`, `data_venda`, `total`, `obs`, `criado_por`, `cast_id`, `comissao_total` | nenhum `CREATE`. Sem `forma_pagamento`, `mesa`, `status`, `origem` | nenhuma | `cast_comissoes.venda_id` referencia `vendas(id)` se a tabela de comissão for criada aqui. O piso não grava `vendas` |
| `pedidos` / `pedidos_itens` | pedido: `id`, `bar_id`, `status`, `total_estimado`, `criado_em`, `data_pedido`, `obs`. Item: `pedido_id`, `produto_id`, `qtd`, `preco_unitario`. Sem `public_code` e sem `entrega_desejada` | índices `pedidos_status_idx` e `pedidos_bar_created_idx` são criados pela migration. `public_code` entra com `ADD COLUMN IF NOT EXISTS` e índice único parcial | nenhuma nas tabelas legadas. As tabelas novas de fulfillment têm policy | `route_pedido`, `_order_fully_at_bar`, recebimento e embarque |
| `cast_members` | `id`, `bar_id`, `nome`, `tipo`, `ativo` no caixa antigo | `CREATE TABLE IF NOT EXISTS` neste arquivo, com `bar_id` obrigatório. Se a tabela já existir com outra chave, o `CREATE` não a reescreve | a migration liga RLS nesta tabela. `sql/pos_sale_security.sql` tem outras policies e não entra neste arquivo | `create_order` usa cast, e `create_order` não é instalado |
| `fornecedores` | `id`, `nome`, `email`, `ativo` | a migration acrescenta `default_lead_time_hours`, `cutoff_time`, `delivery_days` | nenhuma na tabela legada | `sync_supplier_procurement`, `my_supplier_ids` via `supplier_users` |
| `estoque_movimentos` | `produto_id`, `bar_id`, `tipo`, `qtd`, `criado_por`, `obs` | nenhum `CREATE`. `ADD COLUMN IF NOT EXISTS` dessas três colunas. Sem `UPDATE` | nenhuma neste arquivo. O livro continua gravável pelo app como hoje | `pos_sealed_units`, `pos_open_bottle`, `pos_close_ticket`, `pos_void_sale`, `bar_confirm_delivery` (corpo final do procurement) |
| `caixa_movimentos` | produção: `id`, `tipo`, `valor`, `data`, `descricao`. O app da JBM também tenta `metodo` em compras, com erro ignorado | a migration acrescenta `bar_id`, `referencia_tipo`, `referencia_id`, `operational_day`, anuláveis. Sem backfill | policy nova `caixa_movimentos_tenant`. Não havia policy desta tabela no repositório | `pos_close_ticket`, `pos_close_with_charges`, `pos_void_sale` |
| `pos_vendas` | ausente na auditoria de produção | criada no preâmbulo, antes de qualquer `ALTER` do piso | policy `pos_vendas_tenant` | `pos_close_ticket` e o caixa clássico `commitPosSale`, que não é o piso |

`bar_pricing` e `drink_menu` não foram provados naquela leitura. O fixture de dados cria `bar_pricing` sem índice único, com um preço diferente por bar. A migration preserva as duas linhas e cria `bar_pricing_bar_produto_uidx`.

## 2. Compatibilidade com banco existente

O arquivo assume que já existem `bars`, `perfis`, `produtos`, `pedidos`, `pedidos_itens`, `vendas`, `vendas_itens`, `caixa_movimentos`, `estoque_movimentos` e `fornecedores`, e que o projeto Supabase já tem `auth.uid()`, `authenticated` e `anon`. Um Postgres sem essas tabelas para no primeiro `REFERENCES`. Isso é falha clara, não um banco vazio mascarado.

`CREATE TABLE IF NOT EXISTS` só pula a criação. Não muda o tipo de uma coluna que já existe. Onde a coluna usada pelo app pode faltar, o arquivo usa `ADD COLUMN IF NOT EXISTS`. Não usa essa cláusula para esconder chave ou tipo errado.

`my_supplier_ids` era `LANGUAGE sql` e consultava `supplier_users` antes de a tabela existir. No Postgres isso aborta o `CREATE FUNCTION`. Produção não tem `supplier_users`. A função passou a `LANGUAGE plpgsql` com o mesmo `SELECT`. O corpo do procurement continua o que prevalece quando os dois arquivos definem a mesma função.

Policies usam `DROP POLICY IF EXISTS` antes de `CREATE POLICY`. Triggers usados aqui usam `DROP TRIGGER IF EXISTS`. `INSERT` de `procurement_settings` usa `ON CONFLICT (id) DO NOTHING`.

## 3. Caixa histórico

Não há como associar a linha antiga a um bar sem chute. A linha de produção não tem `bar_id` nem `referencia_id`. `descricao` é texto livre (`Compra: …` no caixa da JBM, sem id de bar). Inferir o bar pelo texto seria frágil. A migration não faz `UPDATE`.

Depois da policy `caixa_movimentos_tenant`:

- `admin` e `jbm` (`is_procurement_hq`) continuam vendo a linha com `bar_id` nulo.
- `gerente`, `caixa`, `bar_staff` e `cliente` do bar só passam quando `bar_id` não é nulo e `user_can_access_bar` aceita aquele bar.
- `funcionario`, `staff` e `fornecedor` não passam nessa policy.

O teste local confirmou: a linha `historical-jbm` (`valor` 12345) ficou com `bar_id` nulo e `operational_day` nulo; o papel `jbm` leu 1 linha; o `caixa` do bar leu 0; o mesmo `caixa` leu a linha nova carimbada com o bar dele; o gerente do outro bar leu 0.

Ligar RLS nesta tabela muda o que um papel de bar enxerga no `select *` sem filtro. O caixa do bar no app já filtra `.eq('bar_id', bar.id)`, então a linha nula já não entrava nessa tela. O `Cashflow.jsx` da JBM lê sem filtro e precisa ser `admin` ou `jbm`.

## 4. bar_pricing

Antes de qualquer outro comando, um bloco `DO` conta grupos `(bar_id, produto_id)` com mais de uma linha. Se houver, a mensagem é:

`BLOCKED: bar_pricing has N duplicate (bar_id, produto_id) groups. Resolve them manually. This migration does not delete rows.`

O teste com duas linhas iguais abortou nessa frase. A contagem continuou 2. `pos_vendas` não foi criada, porque a parada é o primeiro comando. Não há `DELETE`. Se a tabela existir sem `bar_id` ou sem `produto_id`, outro `BLOCKED` recusa reescrever a tabela. Quem resolve a duplicata escolhe a linha. A migration não escolhe.

## 5. produtos.bar_id

| Uso | Classe | O que acontece |
|---|---|---|
| `atomic-bar-pos/src/pages/POS.jsx` filtra `produtos.bar_id` e chama `create_order` | D | Caixa antigo, fora do app atual. Não define o catálogo |
| `deduct_stock` em `sql/pos_sale_security.sql` e `migration.sql` | D | Atualiza `produtos.estoque_atual` com `WHERE bar_id`. Não entra em `sql/migration_final.sql` |
| `create_order` nos mesmos arquivos | D | Lê `produtos.bar_id` e grava balcão em `vendas`. Não entra na migration |
| `NOVO_BAR.sql` comenta que `bar_id` isola produto | C | Comentário do seed antigo. Não é query do app atual |
| `Configs`, `Estoque`, `ProcurementBoard`, `Seikyusho`, compras | C | Leem `produtos` sem `bar_id`. Catálogo global intencional |
| Preço de balcão | B | `bar_pricing` (`bar_id`, `produto_id`, `preco_drink`) |
| Preço que a JBM cobra do bar | B | `bar_product_prices` |
| Estoque do bar | B | `estoque_movimentos.bar_id` |
| Mínimo para repor | B | `replenishment_rules` |
| Drink com nome do bar | B | `drink_menu.bar_id` |

Nada disso remove a coluna, porque a coluna não existe em produção e a migration não a cria.

## 6. deduct_stock

O POS novo não chama `deduct_stock`. `src/components/PosFloor.jsx` fecha com `pos_close_ticket` ou `pos_close_with_charges`. `sql/pos_floor.sql` não menciona `deduct_stock`. O teste local confirmou que as funções `deduct_stock` e `create_order` não ficam instaladas.

O estoque do fechamento é uma linha em `estoque_movimentos` (saída de lacrado) ou uma atualização de `pos_bottles` (garrafa aberta). `produtos.estoque_atual` não é decrementado por esse caminho. `Estoque.jsx` também só insere movimento.

`deduct_stock` permanece documentado em `sql/pos_sale_security.sql` como legado incompatível. Não instalar esse arquivo junto com esta migration.

## 7. create_order

Quem chama: só `atomic-bar-pos/src/pages/POS.jsx`. O piso e o `AtomicPos` atual não chamam.

O que gravaria, se alguém instalasse o arquivo antigo: `vendas` com `forma_pagamento`, `mesa`, `status`, `cast_id`, `comissao_total`; `vendas_itens` com `quantidade` e `comissao`; baixa de `produtos.estoque_atual` filtrando `bar_id`; três linhas em `caixa_movimentos` com `bar_id`. Produção não tem essas colunas de `vendas` nem `produtos.bar_id`. Isso misturaria o caixa do bar na conta da JBM.

Esta migration não instala a função e não acrescenta essas colunas. `vendas` continua a conta da JBM. `pos_vendas` é o caixa do bar.

## 8. RLS das tabelas que já estão no ar

Procura no repositório por `CREATE POLICY` em `vendas`, `pedidos`, `perfis` e `produtos`: nenhuma. `sql/pos_sale_security.sql` só cria policy de `cast_members` e `cast_comissoes`, e esse arquivo não faz parte da migration.

Não há, neste repositório, política para classificar `SELECT`, `INSERT`, `UPDATE` ou `DELETE` desses quatro livros por `admin`, `jbm`, `gerente`, `caixa`, `bar_staff`, `cliente`, `funcionario`, `fornecedor` ou `staff`. Dizer que a RLS delas está correta seria inventar. A migration não dá `ENABLE ROW LEVEL SECURITY` nelas e não depende de uma policy delas.

Dependência real: as funções `SECURITY DEFINER` leem `perfis` como dono da função. Sem `FORCE ROW LEVEL SECURITY`, o dono ignora RLS de `perfis`. Se produção tiver `FORCE` em `perfis` e o dono não passar na policy, `user_can_access_bar` quebra. Isso não foi lido. É blocker para chamar o arquivo de production-ready. Não é motivo para alterar essas policies nesta migration.

Papéis nas policies que este arquivo cria, e que o teste exercitou no caixa:

| Papel | `user_can_access_bar` | `is_procurement_hq` / `is_jbm` | Caixa histórico (`bar_id` nulo) | `pos_vendas` do próprio bar | `pos_tickets` via `SELECT` |
|---|---|---|---|---|---|
| `admin` | sim, qualquer bar | sim | vê | vê | vê |
| `jbm` | não | sim | vê | vê, porque a policy do caixa e de `pos_vendas` inclui HQ | não no `SELECT` direto; o RPC `pos_require_bar` aceita `jbm` |
| `gerente`, `cliente` | sim, o próprio bar, se não estiver suspenso | não | não vê | vê e escreve | vê |
| `caixa`, `bar_staff` | sim, o próprio bar, se não estiver suspenso | não | não vê | vê e escreve | vê |
| `funcionario`, `staff` | não | não | não vê | não vê | não vê |
| `fornecedor` | não | não | não vê | não vê | não vê. Vê tarefa e catálogo de fonte pelas policies de procurement quando `supplier_users` o liga |

`funcionario` na folha usa `payroll_my_pack` e as policies de `payroll_lines`, não a policy do caixa.

## 9. Piso

`PosFloor.jsx` carrega comanda, produto e fechamento por RPC (`pos_load_ticket`, `pos_ticket_item`, `pos_close_ticket`, `pos_close_with_charges`). Não chama `commitPosSale`, `deduct_stock` nem `create_order`. `commitPosSale` continua em `AtomicPos.jsx` como caixa clássico, atrás do modo que não é o piso. Os dois livros não se cruzam nesse fluxo: o piso grava `pos_vendas` e `caixa_movimentos`; `create_order` gravaria `vendas` e não está instalado.

## 10. Quem escreve estoque

| Escritor | Tabela | Quando |
|---|---|---|
| `Estoque.jsx`, `PortalCliente.jsx` | `estoque_movimentos` | ajuste manual do bar. Não mexe em `produtos.estoque_atual` |
| `pos_open_bottle` | `estoque_movimentos` saída e `pos_bottles` insert | abre garrafa |
| `pos_bottle_move` | `pos_bottles` | consumo, quebra, cortesia |
| `pos_close_ticket` | `estoque_movimentos` e/ou `pos_bottles`, depois `pos_vendas` e `caixa_movimentos` | fecha a comanda |
| `pos_void_sale` | estorno em `estoque_movimentos` ou `pos_bottles`, e caixa | anula venda do piso |
| `bar_confirm_delivery` | `estoque_movimentos` entrada | o corpo final é o de `sql/procurement.sql`, uma vez, com guarda de idempotência. O corpo antigo de `sql/supplier_fulfillment.sql` é substituído |
| funções de procurement | `procurement_stock_moves` | depósito e trânsito. Não são saldo do bar |
| `deduct_stock` / `create_order` | `produtos.estoque_atual` | não instalados |

Não há segunda tabela de saldo do bar. `procurement_stock_moves` é o depósito, não o estoque do bar.

## 11. Ponto e folha

`break` não é coluna. A API grava uma batida (`tipo` `in` ou `out`). A tela e a folha funcionam sem intervalo. Fica para uma migration futura se o produto passar a gravar pausa. Não é erro deste arquivo.

`transport` não é tipo de `payroll_lines`. Os tipos instalados são `base_salary`, `regular_hours`, `overtime`, `night_premium`, `commission`, `bonus`, `reward`, `advance`, `deduction`, `adjustment`. Bruto e líquido são a soma. Transporte fica para uma migration futura quando existir um escritor. A folha abre e lança os tipos atuais sem ele.

Os dois são blockers funcionais de produto, não falha estrutural desta migration.

## 12. Segunda execução

No banco legado vazio e no banco com dados simulados, o mesmo arquivo rodou de novo. Policies não duplicaram (`DROP POLICY IF EXISTS`). A linha histórica de caixa continuou uma. Os dois preços de `bar_pricing` continuaram dois. Não houve `DELETE` de histórico.

A segunda execução não é um no-op silencioso: ela recria funções e policies com o mesmo corpo. Isso é substituição idempotente, não uma segunda cópia de dado.

## 13. O que o teste local provou

`npm run test:migration:pg`:

- catálogo legado sem linhas: a migration aplica e aplica de novo;
- catálogo com dois bares, produto global, dois preços, caixa histórico, estoque, pedido, venda e os papéis acima: dados preservados, RLS do caixa como na seção 3, `produtos` sem `bar_id`, `vendas` sem colunas de balcão;
- duplicata de `bar_pricing`: aborta com `BLOCKED` e não apaga a linha.

## 14. O que ainda impede executar em produção

- Ninguém leu `pg_policy` de `vendas`, `pedidos`, `perfis` e `produtos` no banco real.
- O fixture não é o catálogo real. Uma constraint que o repositório não vê pode abortar o script. O desenho é falhar sem `DELETE`, mas isso precisa de uma janela humana.
- A policy nova de `caixa_movimentos` é mudança de comportamento para quem lia a tabela inteira sem ser `admin` ou `jbm`.
- Duplicata real de `bar_pricing`, se existir, exige passo manual antes de rodar o arquivo.
- `break` e `transport` continuam fora, de propósito.
