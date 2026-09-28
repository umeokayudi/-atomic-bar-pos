# Instalação do banco — Atomic Bar POS / JBM

Este documento é o mapa do schema que o código espera. Ele não foi aplicado em produção. Os projetos `ojirgkqtqvugqktyuhem` e `fxsakrshmldmkdmbevna` não foram consultados nem alterados.

A ordem abaixo não é a migration de produção. Vários scripts atuais assumem colunas e tabelas que a auditoria de produção não encontrou (`produtos.bar_id`, `pos_vendas`). A decisão fechada está em `docs/database-architecture-resolution.md`. Não instalar o pacote até existir uma única migration feita a partir desse documento.

O editor SQL do Supabase não inclui outro arquivo. `sql/master_schema.sql` só funciona no `psql`, com `\ir`. No editor, cole cada arquivo abaixo, um por vez, nesta ordem.

## Ordem

O banco já precisa ter o catálogo antigo (bares, produtos, pedidos, vendas, POS, caixa, perfis). Nenhum SQL deste repositório cria essas tabelas. Não foram inventadas aqui.

1. `migration.sql`  
   Cast, colunas em `vendas`, `caixa_movimentos` e `produtos`, e a primeira versão de `user_can_access_bar`, `deduct_stock` e `create_order`.

2. `sql/pos_sale_security.sql`  
   Substitui essas três funções pela versão deste repositório e recria as policies de cast. Depende de `perfis`, `produtos`, `vendas`, `vendas_itens`, `cast_members`.

3. `sql/supplier_fulfillment.sql`  
   Portal do fornecedor em cima de `pedidos` e `fornecedores`. Depende de `user_can_access_bar`.

4. `sql/procurement.sql`  
   Compra, recebimento, depósito e envio. Substitui `is_jbm`, `supplier_advance`, `bar_confirm_delivery` e as policies de `fulfillment_alerts`. Tem de ser o último arquivo a escrever essas funções.

5. `sql/pos_floor.sql`  
   Comanda, garrafa, movimento e fechamento do caixa. Escreve em `pos_vendas` e `caixa_movimentos`. Não escreve `vendas` nem procurement.

5b. `sql/pos_ux.sql`  
   Configuração do caixa por bar (favoritos, IA, serviço, imposto, acréscimo de cartão) e o fechamento que soma essas taxas na mesma venda. Não cria produto, pedido nem um segundo livro. Não aplicar em produção. Depende de `pos_close_ticket`.

6. `sql/payroll.sql`  
   Folha. Lê `time_clock` e `perfis`. Não cria o ponto.

7. `sql/bar_employees.sql`  
   Convites e status do funcionário do bar (`invited`, `active`, `suspended`, `inactive`). Reescreve `user_can_access_bar` para recusar quem está suspenso, inativo ou ainda não aceitou o convite. Não guarda senha e não apaga `perfis`.

Não fazem parte da instalação: `seed_usuarios.sql`, `RESET_UMEOKAGROUP.sql`, `NOVO_BAR.sql`. Eles criam login ou bar.

Depois, rode `sql/verify_schema.sql`. Ele só lê. Uma linha `MISSING` ou `CONFLICT` significa que a instalação não está completa. A linha `SUMMARY` fica `OK` só quando todas as outras estão `OK`.

## Dependências

```
catálogo legado (já no banco, fora deste repositório)
  bars, perfis, produtos, pedidos, pedidos_itens
  vendas, vendas_itens, pos_vendas, pos_vendas_itens
  caixa_movimentos, fornecedores, estoque_movimentos
        │
        ▼
migration.sql
        │
        ▼
sql/pos_sale_security.sql
        │
        ├──────────────────────┐
        ▼                      ▼
sql/supplier_fulfillment.sql  (user_can_access_bar)
        │
        ▼
sql/procurement.sql
        │
        ▼
sql/pos_floor.sql
        │
        ▼
sql/payroll.sql          (também exige time_clock já existente)
```

Rodar `supplier_fulfillment.sql` de novo depois do procurement desfaz `supplier_advance`, `bar_confirm_delivery` e a policy de alerta do funcionário. O aviso está no topo daquele arquivo.

## Inventário

Estado abaixo é o estado **do repositório**, não o estado de produção. Produção não foi lida. A tela de Fulfillment em https://jbmtech.vercel.app já mostrou que `supplier_fulfillment.sql` não está aplicado. O restante da produção continua desconhecido até alguém rodar `sql/verify_schema.sql` lá.

| Módulo | Tabelas neste repositório | RPC que o app chama | RLS no SQL | Estado no repositório |
|---|---|---|---|---|
| Legado / cast | `cast_members`, `cast_comissoes` | `create_order`, `deduct_stock` | sim | escrito em `migration.sql` |
| POS security | nenhuma nova | `user_can_access_bar` | policies de cast | escrito |
| Fulfillment | `supplier_users`, `supplier_products`, `supplier_routing_rules`, `pedido_fulfillment`, `order_supplier_assignments`, `order_supplier_items`, `fulfillment_events`, `delivery_confirmations`, `supplier_purchase_requests`, `fulfillment_alerts`, `audit_logs` | `route_pedido`, `supplier_advance`, `bar_confirm_delivery`, `get_order_tracking`, `scan_fulfillment_alerts` | sim | escrito; produção ainda sem este arquivo |
| Procurement | `ops_counters`, `procurement_settings`, `ops_closures`, `procurement_sources`, `procurement_source_products`, `procurement_routing_rules`, `locations`, `procurement_tasks`, `purchase_transactions`, `purchase_lines`, `shipments`, `shipment_items`, `procurement_stock_moves`, `bar_product_prices`, `replenishment_rules`, `order_idempotency_keys` | `submit_bar_order`, `plan_procurement`, `record_purchase`, `receive_procurement`, `create_shipment`, `advance_shipment`, `confirm_bar_shipment`, `get_procurement_tracking`, `get_procurement_board`, `get_procurement_tasks_hq`, `get_my_procurement_tasks`, `task_economics`, `fallback_task`, `release_open_quantity`, `flag_deadline_exception` | sim | escrito; depende do fulfillment |
| POS floor | `pos_tickets`, `pos_ticket_items`, `pos_bottles`, `pos_bottle_moves`, `pos_recipes`, `pos_recipe_lines`, `pos_idempotency`, `pos_sale_events` | `pos_load_ticket`, `pos_ticket_item`, `pos_preview_ticket`, `pos_close_ticket`, `pos_open_bottle`, `pos_bottle_move`, `pos_bottle_board`, `pos_void_sale`, `pos_save_ticket` | sim | escrito |
| Payroll | `payroll_rules`, `payroll_periods`, `payroll_lines`, `payroll_audit`, `payroll_shift_plans`, `payroll_occurrences`, `payroll_points`, `payroll_goal_notes`, `payroll_rewards`, `payroll_advances`, `payroll_deductions` | `payroll_hq_board`, `payroll_my_pack`, `payroll_open_period`, `payroll_transition`, `payroll_adjust` | sim | escrito |
| Holding | nenhuma neste projeto | nenhuma no banco de drinks | — | `jbm_financeiro` e `hr_placements` pertencem ao outro Supabase. Não criar no banco do bar |

Não há views nem enums criados por esses arquivos. O app lê a view `produtos_public`, que também não está no repositório.

`pos_vendas` continua sendo a venda do caixa. `vendas` continua sendo o livro da JBM. `pedidos` continua sendo o pedido do bar. `fornecedores` continua sendo o fornecedor. `estoque_movimentos` continua sendo o estoque selado. Os arquivos novos não criam um segundo cadastro.

## Objetos que o app usa e este repositório não cria

Estes nomes aparecem em `supabase.from` ou no servidor e não têm `CREATE TABLE` / `CREATE VIEW` em nenhum SQL daqui. Não foram criados nesta auditoria.

`bars`, `perfis`, `produtos`, `produtos_public`, `pedidos`, `pedidos_itens`, `vendas`, `vendas_itens`, `pos_vendas`, `pos_vendas_itens`, `caixa_movimentos`, `fornecedores`, `fornecedor_precos`, `compras`, `compras_itens`, `faturas`, `fatura_pagamentos`, `ryoshusho`, `notificacoes`, `estoque_movimentos`, `estoque_regras`, `drink_menu`, `bar_pricing`, `discount_codes`, `vip_members`, `vip_usages`, `drink_back_agents`, `bar_spaces`, `bar_guests`, `bar_visits`, `bar_bottle_keeps`, `pos_settings`, `pos_shifts`, `time_clock`, `bar_hq_meta`, `bar_overhead`.

O app em produção já abre Dashboard, Compras e Vendas, então a maior parte desse catálogo já existe no banco antigo. `sql/verify_schema.sql` marca cada um como `MISSING` se não estiver lá. Sem essa leitura, o estado real continua desconhecido.

Colunas que os scripts só acrescentam, se a tabela antiga já existir: `vendas.mesa`, `vendas.cast_id`, `vendas.comissao_total`, `vendas.status`, `caixa_movimentos.referencia_tipo`, `caixa_movimentos.referencia_id`, `caixa_movimentos.operational_day`, `produtos.estoque_minimo`, `produtos.estoque_maximo`, `produtos.volume_ml`, `fornecedores.ativo`, `fornecedores.default_lead_time_hours`, `pedidos.public_code`, `fulfillment_alerts.assignee_user_id`, `pos_vendas.drink_back_agent_id`, `pos_vendas.card_fee`, `pos_vendas.void_status`, `pos_vendas_itens.stock_mode`.

## Funções repetidas

Não ficam duas versões com a mesma assinatura. `CREATE OR REPLACE` troca o corpo.

| Função | Onde nasce | Onde fica a versão final |
|---|---|---|
| `user_can_access_bar`, `deduct_stock`, `create_order` | `migration.sql` e `sql/pos_sale_security.sql` | `sql/pos_sale_security.sql` |
| `is_jbm` | fulfillment e procurement | procurement, mesmo critério (`admin`, `jbm`) |
| `supplier_advance` | fulfillment, depois procurement | procurement |
| `bar_confirm_delivery` | fulfillment, depois procurement | procurement; o recebimento de estoque do fluxo novo é `confirm_bar_shipment` |

`deduct_stock(uuid, integer)` e `pos_void_sale` de cinco argumentos são removidos de propósito. O verificador marca `CONFLICT` se ainda existirem.

`get_order_tracking` e `get_procurement_tracking` são funções diferentes. O app tenta a de procurement e, se o schema não existir, cai na de fulfillment.

## SECURITY DEFINER

Toda função `SECURITY DEFINER` destes arquivos usa `SET search_path = public`. Nenhuma policy dos scripts usa `USING (true)` ou `WITH CHECK (true)`.

As RPC expostas ao usuário autenticado checam `auth.uid()` e, quando a linha é de um bar, `user_can_access_bar` ou `pos_require_bar`. Isolamento de bar no caixa está nas funções, não só na tela.

Funções internas (`pos_log`, `pos_lock_stock`, `next_ops_code`, `_touch_fulfillment`, `_stock_move`, `sync_supplier_procurement` e as demais com prefixo `_`) são `SECURITY DEFINER`, têm `search_path` fixo e `REVOKE` de `PUBLIC`. Elas não recebem `GRANT` para `authenticated` no SQL. Quem chama é outra função que já autorizou. Confirme no verificador, depois da instalação, que `anon` não consegue executá-las. O default do Supabase às vezes concede `EXECUTE` a `anon` e `authenticated` fora do arquivo.

`funcionario` e `staff` não passam em `is_jbm` nem em `is_procurement_hq`. Tarefa de compra do funcionário entra por `get_my_procurement_tasks` e pelo `assigned_to`. Fornecedor entra por `supplier_users` / `my_supplier_ids`. `gerente`, `caixa`, `bar_staff` e `cliente` entram no bar ligado em `perfis.bar_id` via `user_can_access_bar`. `admin` passa. `jbm` passa nas funções de HQ, não como caixa de outro bar, a menos que o perfil também tenha aquele `bar_id`.

## Avisos do frontend

Estes textos continuam no código. Eles somem quando a chamada deixa de falhar por schema ausente.

- `fulfillment.schemaMissing` — pede `sql/supplier_fulfillment.sql`
- `procurement.schemaMissing` e `procurement.notConfigured` — pedem `sql/procurement.sql` depois do fulfillment
- `employee.schemaMissing` — pede `sql/payroll.sql`

Há também avisos de ambiente que não são tabela: `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `GEMINI_API_KEY`, `POS_REORDER_WEBHOOK_URL`, GPS do bar.

## Riscos que continuam manuais

- Produção não foi lida. O único fato confirmado na interface é a falta do fulfillment.
- `sql/pos_floor.sql` faz `ALTER COLUMN ... DROP NOT NULL` em `pos_sale_events`. Se essa tabela já existir com outro formato, o script para. Não foi reescrito para esconder isso.
- `payroll_my_pack` lê `time_clock`. Se o ponto não existir, a função é criada e falha na chamada.
- `pos_floor` lê `estoque_movimentos`, `drink_menu` e `pos_vendas`. Se alguma dessas tabelas não existir, a instalação para no meio.
- `jbm_financeiro` e `hr_placements` não devem ser criados no banco do bar.
- Não rode os SQL de senha (`seed_usuarios.sql`, `RESET_UMEOKAGROUP.sql`) como se fossem schema.
