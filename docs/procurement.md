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

Auditoria do PR #38: as funções `SECURITY DEFINER` checam `auth.uid` e `is_jbm` / `user_can_access_bar` / `my_supplier_ids` antes de escrever. Helpers internos não têm `GRANT` para `authenticated`. `is_jbm()` ainda trata `funcionario` como JBM no fulfillment antigo. O procurement novo não usa isso: funcionário não é HQ.

Este ambiente não tem chave do Supabase, então as RPC não foram chamadas contra outro bar. A negativa está no `RAISE EXCEPTION 'not allowed'` de cada função. As regras de divisão, prazo, preço e isolamento estão em `src/lib/procurementCore.js` e `npm run test:procurement`.

## Como aplicar

1. No SQL editor do projeto drinks, se ainda não rodou: `sql/pos_sale_security.sql` e `sql/supplier_fulfillment.sql`.
2. Rodar o arquivo inteiro `sql/procurement.sql`. Se uma versão anterior deste arquivo já foi aplicada, rode de novo: as policies são recriadas e as constraints novas só entram se ainda não existirem. Uma constraint falha se já houver linha com quantidade impossível.
3. Não rodar de novo por cima de um `supplier_fulfillment.sql` antigo sem repetir `procurement.sql`, porque o fulfillment recria a policy de alertas.
4. Recarregar o site com Ctrl+Shift+R ou Cmd+Shift+R.

O arquivo não cria produto, pedido, bar nem preço de exemplo. Fontes que não são fornecedor são cadastradas na aba Procurement.
