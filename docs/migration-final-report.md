# Relatório da migration final

Migration designed but not executed.

`sql/migration_final.sql` está pronto para revisão humana. Não foi aplicado em `ojirgkqtqvugqktyuhem`, nem no holding `fxsakrshmldmkdmbevna`, nem num banco local nesta etapa. Não houve deploy.

O resultado desta etapa é **MIGRATION READY FOR REVIEW**. Não é migration aplicada e não é production ready.

## 1. O que foi criado

O arquivo único `sql/migration_final.sql`, gerado por `scripts/buildMigrationFinal.mjs`. O validador estático é `scripts/validateMigration.mjs` (`npm run test:migration`).

Objetos novos, todos com `CREATE TABLE IF NOT EXISTS` quando o script fonte já era idempotente:

- Caixa do bar: `pos_vendas`, `pos_vendas_itens`.
- Cardápio e preço de balcão: `drink_menu`, `bar_pricing`, índice único `bar_pricing_bar_produto_uidx`.
- Piso: `bar_spaces`, `pos_tickets`, `pos_ticket_items`, `pos_bottles`, `pos_bottle_moves`, `pos_recipes`, `pos_recipe_lines`, `pos_idempotency`, `pos_sale_events`.
- CRM: `bar_guests`, `bar_visits`.
- Ponto: `time_clock` e o trigger `time_clock_guard`.
- Comissão antiga, se ainda não existir: `cast_members`, `cast_comissoes`.
- Fulfillment, procurement, folha, `bar_employees` e `pos_bar_config`, copiados dos scripts já revisados, nesta ordem: fulfillment, procurement, piso (sem o `UPDATE` de histórico), folha, funcionários, `sql/pos_ux.sql`.

Policies de tenant para as tabelas criadas no preâmbulo e para `caixa_movimentos`.

## 2. O que foi alterado

Só de forma aditiva:

- `caixa_movimentos`: `bar_id`, `referencia_tipo`, `referencia_id`, `operational_day`, todos anuláveis.
- `estoque_movimentos`: `bar_id`, `criado_por`, `obs`, com `ADD COLUMN IF NOT EXISTS` (produção já mostrou essas colunas).
- `pos_vendas` e `pos_vendas_itens`: os `ALTER` do piso passam a encontrar a tabela criada no começo do mesmo arquivo.
- `user_can_access_bar` é criada cedo para os scripts seguintes e substituída no fim por `sql/bar_employees.sql`, que recusa suspenso, inativo e convite ainda não aceito.
- Funções em que fulfillment e procurement discordam ficam com o corpo de `sql/procurement.sql`.
- RLS em `caixa_movimentos`. Linha com `bar_id` nulo continua visível para HQ (`admin` / `jbm`). Usuário de bar só vê linha carimbada com o próprio bar.

O `UPDATE` que preenchia `operational_day` em todo o caixa antigo foi retirado. O `UPDATE` que resta está dentro de `pos_close_with_charges` e mexe numa única entrada da venda que acabou de fechar, na mesma transação. Se essa linha não for exatamente uma, a função aborta.

## 3. O que foi preservado

- `produtos` sem `bar_id`. Nenhum produto é inserido nem duplicado.
- `vendas` como conta da JBM. Sem `forma_pagamento`, `mesa`, `status`, `origem`.
- `perfis` como única identidade. Sem segunda tabela de usuário e sem segundo login.
- `produtos.estoque_atual` como contador global legado. O saldo do bar continua a soma de `estoque_movimentos`.
- Histórico: sem `DELETE` em massa, sem `DROP TABLE`, sem `UPDATE` de linhas antigas de caixa.
- `deduct_stock` e `create_order` ficam de fora. Eles ainda filtram `produtos.bar_id`.
- RLS desligado, neste arquivo, para `vendas`, `pedidos`, `perfis` e `produtos`.

## 4. Dependências

O arquivo assume que já existem `bars`, `perfis`, `produtos`, `pedidos`, `pedidos_itens`, `vendas`, `vendas_itens`, `caixa_movimentos`, `estoque_movimentos` e `fornecedores`. Um banco vazio falha no primeiro `REFERENCES public.bars`. Isso é esperado. Este arquivo não cria o catálogo legado.

Ordem interna, que não deve ser invertida:

1. Helper de acesso, tabelas do caixa, cardápio, mesas, convidados, ponto, colunas do caixa.
2. `sql/supplier_fulfillment.sql`.
3. `sql/procurement.sql`.
4. `sql/pos_floor.sql` sem o backfill.
5. `sql/payroll.sql`.
6. `sql/bar_employees.sql`.
7. `sql/pos_ux.sql`, que chama `pos_close_ticket`.
8. Policies do preâmbulo.

`sql/pos_sale_security.sql` e o miolo perigoso de `migration.sql` não entram. `sql/master_schema.sql` continua sendo um mapa de `\ir` para `psql`, não a instalação de produção.

## 5. Riscos

- Ligar RLS em `caixa_movimentos` muda o que o usuário de bar enxerga. Linhas antigas sem `bar_id` somem da visão do bar e continuam na visão HQ. Enquanto a policy não existir, o comportamento atual de produção permanece.
- `CREATE UNIQUE INDEX` em `bar_pricing` falha se o par `(bar_id, produto_id)` já estiver duplicado. A migration para. Não apaga a duplicata.
- `CREATE TABLE IF NOT EXISTS` não altera chave primária de uma tabela que já exista com outro formato. As colunas usadas pelo app são acrescentadas com `ADD COLUMN IF NOT EXISTS` onde isso é seguro. Um tipo diferente na mesma coluna não é reescrito.
- O piso ainda faz `DROP FUNCTION` de duas sobrecargas (`pos_open_bottle` de 4 argumentos e `pos_void_sale` de 5) e recria o check de `pos_sale_events`. Não apaga linha. Se produção já tiver essas funções com outro significado, a substituição muda o corpo.
- `pos_close_with_charges` aumenta `pos_vendas.total` e a entrada de caixa para o total do cliente quando serviço, imposto ou acréscimo estão ligados. O padrão de `pos_bar_config` deixa esses valores desligados, então o fechamento sem configuração continua o subtotal da bebida.
- A taxa de 3,78% já existente é custo de operadora (`card_fee` / `taxa_cartao`), não o acréscimo cobrado do cliente.

## 6. O que continua bloqueado

- `produtos.bar_id`.
- Colunas de balcão em `vendas`.
- `deduct_stock` e `create_order`.
- Backfill de `caixa_movimentos.bar_id` e de `operational_day`.
- `ENABLE ROW LEVEL SECURITY` em `vendas`, `pedidos`, `perfis` e `produtos` até alguém ler as policies reais.
- Coluna `break` no ponto. A API grava batida, não intervalo.
- Tipo de folha `transport`. Não há escritor. Bruto e líquido não viram colunas.
- Tabelas que o fechamento do piso não exige e que este repositório não define: `pos_settings`, VIP, desconto, `bar_bottle_keeps`.
- Policies de produção das tabelas que já estão no ar. Continuam desconhecidas.

## 7. Ordem recomendada de execução

1. Revisar este relatório e o diff de `sql/migration_final.sql`.
2. Rodar o arquivo num banco descartável que já tenha o catálogo legado, nunca em `supabase.co` de produção.
3. Rodar `sql/verify_schema.sql` só como leitura, sabendo que ele ainda descreve o mapa antigo e não substitui o validador desta migration.
4. Só então um humano decide a janela de produção. Esta etapa não executa esse passo.

## 8. Como validar depois da execução

Antes de executar, `npm run test:migration` confere o texto: tabelas, colunas, funções, RLS das tabelas de bar, ausência de `USING (true)`, `search_path` em `SECURITY DEFINER`, ausência de `produtos.bar_id`, separação `vendas` / `pos_vendas`, e ausência do backfill.

Depois de executar num banco descartável:

- `\d pos_vendas` mostra `bar_id` e a tabela existe antes de qualquer venda.
- `caixa_movimentos` tem as quatro colunas novas e as linhas antigas continuam com `bar_id` nulo.
- `produtos` não tem `bar_id`.
- `vendas` não ganhou `forma_pagamento`.
- Fechar a mesma comanda duas vezes com a mesma chave devolve `duplicate` e não cria segunda `pos_vendas`.
- Uma batida `in` seguida de outra `in` falha. Uma `out` sem `in` falha.
- Usuário de um bar não lê `pos_vendas` de outro bar.

## 9. Rollback e recuperação

O arquivo não traz um script de desfazer. Objetos novos podem ficar sem uso se o aplicativo não for apontado para eles. Não dropar tabela de produção para “voltar”.

Se a única mudança de comportamento indesejada for a policy de `caixa_movimentos`, dropar essa policy e desligar o RLS só dessa tabela devolve a visibilidade anterior do caixa, sem apagar movimento. Isso também é uma decisão humana, não um passo desta etapa.

Não há backfill para reverter porque nenhum histórico foi reescrito.

## Conclusão

Migration designed but not executed.

Produção permanece inalterada.
