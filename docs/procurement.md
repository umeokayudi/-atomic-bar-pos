# Procurement em cima do PR #38

`submit_bar_order` é o único caminho para o bar enviar um pedido. A função grava o pedido, os itens com o preço daquele bar e o plano na mesma transação. Se `sql/procurement.sql` ainda não foi aplicado, a tela mostra o erro e não cria pedido.

O pedido do bar continua em `pedidos` / `pedidos_itens`. O produto continua em `produtos`. O bar continua em `bars`. O fornecedor continua em `fornecedores`. O portal do fornecedor continua em `order_supplier_assignments`. Esta camada diz **como** a Umeoka abastece esse pedido.

```
bars ── pedidos ── pedidos_itens ── produtos
                      │
                      └── procurement_tasks ── procurement_sources
                            │                      │
                            │                      ├── SUPPLIER → fornecedores
                            │                      ├── ONLINE / PHYSICAL_STORE
                            │                      ├── EMPLOYEE / PARTNER
                            │                      ├── WAREHOUSE / DIRECT
                            │                      └── procurement_source_products
                            ├── purchase_transactions ── purchase_lines
                            └── shipment_items ── shipments ── locations
                                                      │
                                                      └── bar confirma → estoque_movimentos
bar_product_prices (bar + produto, sem copiar o produto)
replenishment_rules (estrutura apenas, sem previsão)
```

Códigos humanos (`BAR-2026-00001`, `BUY-`, `PUR-`, `DEL-`, `SUP-`) ficam ao lado do UUID.

## O que o PR #38 continua fazendo

- `route_pedido`, `supplier_advance`, `bar_confirm_delivery`, `get_order_tracking` seguem no banco.
- `supplier_advance` foi substituído no arquivo novo, com a mesma assinatura. Se a tarefa de procurement existe, recusa cancela essa tarefa e replaneja o restante. Compra do fornecedor só grava `purchased` na tarefa se houver custo. Sem tarefa ligada, o fluxo antigo de `route_pedido` permanece.
- `delivery_confirmations` continua único por pedido e passa a ser preenchido quando a quantidade confirmada no bar cobre o pedido. Várias entregas vivem em `shipments`.

## Máquina da tarefa

`assigned → waiting_purchase → purchasing → purchased → in_transit → received | partially_received → completed`

`purchased` só entra por `record_purchase` (quem comprou, quando, origem, quantidade, custo unitário). Recebimento no bar não entra no estoque por essa função. Estoque do bar só em `confirm_bar_shipment`, com obs `JBM ship …`, e o pedido só vai a `entregue` quando a soma no bar cobre cada linha.

## Prazo

`procurement_deadlines` caminha para trás a partir do horário pedido, em `Asia/Tokyo`. Horas de transporte, depósito, preparo e buffer vêm de `procurement_settings`. Lead time, cutoff e dias vêm da origem. Feriados entram só se houver linha em `ops_closures`. Nada disso está fixo na função.

## Quem vê o quê

`procurement_tasks` só tem SELECT direto para `is_procurement_hq()` (`admin` ou `jbm`). Fornecedor e funcionário não leem a tabela. Eles usam RPC.

- Bar: `submit_bar_order` e `get_procurement_tracking`, com o próprio preço, status, embarque e quantidade recebida. Sem custo, frete, taxa, logística, margem ou nome da origem.
- JBM: `get_procurement_tasks_hq` para a lista. Custo e margem em `task_economics` e no campo `economics` de `get_procurement_board`. Alertas de audiência `jbm` também exigem `is_procurement_hq()`, não o `is_jbm()` antigo.
- Fornecedor: `get_procurement_tracking` só das tarefas da origem dele. Sem `expected_unit_cost`, custo real, frete, taxa, logística, margem ou preço de venda.
- Funcionário: `get_my_procurement_tasks` recusa role `fornecedor` e devolve só `assigned_to = auth.uid()`.

## Quantidade

O banco recusa a linha se `purchased > allocated`, `received > purchased` ou `at_bar > received` (`procurement_tasks_qty_chk`). Recebimento não copia a quantidade comprada. `receive_procurement` e a entrega num depósito somam só o que chegou e gravam `procurement_stock_moves`. A saída do depósito grava `out` na partida. Cancelar um embarque que já saiu devolve o saldo com um `in`, sem apagar o movimento anterior.

Saída direta até o bar usa a quantidade comprada ainda não embarcada. A confirmação do bar é o recebimento dessa mercadoria: sobe `quantity_received` e `quantity_at_bar` juntos, e só então entra em `estoque_movimentos`. Pelo depósito, a confirmação só sobe `quantity_at_bar`, e nunca acima do que já foi recebido.

Um embarque não mistura pedidos, não sai de um bar para outro bar, e o destino `BAR` tem de ser o bar do pedido.

## Compra, custo e cancelamento

`record_purchase` continua obrigatório para marcar `purchased`. Funcionário e fornecedor não informam outro custo: usam `expected_unit_cost`. Frete e taxa só a HQ grava. `task_economics` e o bloco `economics` de `get_procurement_board` ficam só para HQ.

`fallback_task` recusa tarefa com compra, recebimento, quantidade no bar ou embarque ativo, mesmo que o status ainda seja `purchasing`. `release_open_quantity` solta só o que ainda não foi comprado e replaneja. As linhas de `purchase_lines` permanecem.

Fornecedor, no tracking, vê a quantidade da própria tarefa. Não vê o restante da linha, o estoque do bar, o preço de venda nem o embarque. Funcionário vê só a tarefa em que `assigned_to` é o próprio usuário.

Pedido com quantidade ainda sem origem permanece `pendente`. Preço ausente ou zero cancela a transação inteira. O pedido só vai a `entregue` quando cada linha tem `quantity_at_bar` cobrindo a quantidade pedida.

Não há `USING (true)`.

`is_jbm()` é `admin` ou `jbm`. Funcionário não entra. O portal do fornecedor e o bar do próprio usuário continuam. `route_pedido`, `supplier_advance` e `get_order_tracking` usam essa função para o lado HQ. O funcionário compra pela tarefa atribuída, com o custo já combinado.

O status do fornecedor (`in_transit`, `partial`, `delivered` no assignment) não altera a tarefa, `quantity_received`, o estoque nem `pedidos.status`. A tela mostra que essa marca não é recebimento. Recebimento continua em `receive_procurement`, no embarque ou em `confirm_bar_shipment`.

`submit_bar_order` aceita `p_idempotency_key`. A mesma chave, o mesmo usuário e o mesmo bar devolvem o pedido já gravado. A chave só é inserida depois do pedido, na mesma transação. Se a transação falha, a chave não fica presa. Pedidos antigos sem chave continuam válidos.

`bar_confirm_delivery` permanece para pedido sem tarefa de procurement. Se já existe tarefa, a função recusa e o estoque só entra por `confirm_bar_shipment`. Isso evita estoque duplicado e impede marcar `entregue` com uma linha ainda aberta.

Auditoria do PR #38: as funções `SECURITY DEFINER` checam `auth.uid` e o papel antes de escrever. Helpers internos não têm `GRANT` para `authenticated`. `replenishment_rules` não é lida por nenhuma função deste fluxo.

Este ambiente não tem chave do Supabase, então as RPC não foram chamadas contra outro bar. A negativa está no `RAISE EXCEPTION 'not allowed'` de cada função. As regras de divisão, prazo, preço e isolamento estão em `src/lib/procurementCore.js` e `npm run test:procurement`.

## Como aplicar

Ordem, no SQL editor do projeto drinks. Este repositório não executa esse SQL.

1. `sql/pos_sale_security.sql`
2. `sql/supplier_fulfillment.sql`
3. `sql/procurement.sql`

O passo 3 tem de ser o último. `supplier_fulfillment.sql` recria `is_jbm()`, `supplier_advance`, `bar_confirm_delivery` e as policies de alerta. Se ele rodar depois do procurement, o recebimento antigo volta e o estoque pode entrar sem `confirm_bar_shipment`. Nesse caso, rode `sql/procurement.sql` de novo.

## O que a reexecução faz

Pode repetir `sql/procurement.sql` por cima dele mesmo. Não há `DROP TABLE`, `DELETE` de pedido nem `TRUNCATE`.

Idempotente:

- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
- `CREATE OR REPLACE` das funções, com `search_path = public`
- `DROP POLICY IF EXISTS` e a policy nova
- `DROP FUNCTION IF EXISTS submit_bar_order(uuid, timestamptz, text, jsonb)` e a função de 5 argumentos. A de 4 argumentos deixa de existir. O cliente atual manda `p_idempotency_key`; sem a chave, o quinto argumento fica nulo e o pedido antigo continua válido
- o check de `audience` em `fulfillment_alerts`: o bloco apaga o check cujo texto contém `audience` e cria `fulfillment_alerts_audience_chk` de novo

Não é idempotente, ou falha se o banco já tiver dado incompatível:

- `procurement_tasks_qty_chk` é removida e criada de novo em toda execução. Se alguma tarefa já tiver quantidade negativa, `purchased` acima de `allocated`, `received` acima de `purchased`, `at_bar` acima de `received`, ou status incompatível com a quantidade, o `ADD CONSTRAINT` aborta o script. Nada é apagado; a constraint antiga volta se o editor rodar o arquivo numa transação.
- `CREATE TABLE IF NOT EXISTS` não altera colunas de uma tabela que já exista. Se um rascunho anterior deste arquivo criou `procurement_tasks` com outra forma, comparar as colunas antes de confiar na reexecução. O check de status da tarefa está no `CREATE TABLE` e não é trocado na segunda rodada.
- `fulfillment_alerts_audience_chk` recusa `audience` fora de `jbm`, `bar`, `supplier`, `employee`. Linha antiga com outro valor faz o `ADD CONSTRAINT` falhar.
- `GRANT` de `supplier_advance` fica no arquivo de fulfillment. `CREATE OR REPLACE` no procurement preserva esse grant. Sem o passo 2, a função nova não deve ser aplicada sozinha.

O arquivo não cria produto, pedido, bar nem preço de exemplo. Fontes que não são fornecedor são cadastradas na aba Procurement. Depois de aplicar, recarregar o site com Ctrl+Shift+R ou Cmd+Shift+R.
