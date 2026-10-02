# Auditoria: instalação em Supabase vazio

Base lida: `cursor/staging-implementation-9d4b` em `f28a3c9` (PR #72). Nenhum SQL foi executado. Nenhum banco foi aberto. Produção não foi consultada.

Conclusão: o repositório **não está preparado** para um Supabase vazio. As migrations novas alteram e leem um catálogo que este repositório não cria. Sem esse DDL, `migration.sql` para no primeiro `ALTER TABLE vendas`.

## O que os arquivos criam

Não há `CREATE TYPE` nem `CREATE EXTENSION` nos arquivos de instalação. `gen_random_uuid()` e `auth.uid()` são usados e não são definidos aqui. O schema `auth` vem da plataforma Supabase, não destes arquivos.

Há um trigger: `bar_product_prices_audit` em `sql/procurement.sql`.

| Arquivo | Cria | Altera tabelas que ele não cria | Não cria |
| --- | --- | --- | --- |
| `migration.sql` | `cast_members`, `cast_comissoes`; funções iniciais `user_can_access_bar`, `deduct_stock`, `create_order`; RLS de cast | `vendas`, `caixa_movimentos`, `produtos` | o catálogo legado |
| `sql/pos_sale_security.sql` | substitui as três funções; policies `cast_members_bar_access`, `cast_comissoes_bar_access` | nenhuma tabela nova | `perfis`, `produtos`, `vendas`, `vendas_itens` |
| `sql/supplier_fulfillment.sql` | `supplier_users`, `supplier_products`, `supplier_routing_rules`, `pedido_fulfillment`, `order_supplier_assignments`, `order_supplier_items`, `fulfillment_events`, `delivery_confirmations`, `supplier_purchase_requests`, `fulfillment_alerts`, `audit_logs`; funções e policies listadas em `sql/verify_schema.sql` | `fornecedores` (`ativo`, `default_lead_time_hours`, `cutoff_time`, `delivery_days`) | `pedidos`, `pedidos_itens`, `fornecedores`, `produtos` |
| `sql/procurement.sql` | `ops_counters`, `procurement_settings`, `ops_closures`, `procurement_sources`, `procurement_source_products`, `procurement_routing_rules`, `locations`, `procurement_tasks`, `purchase_transactions`, `purchase_lines`, `shipments`, `shipment_items`, `procurement_stock_moves`, `bar_product_prices`, `replenishment_rules`, `order_idempotency_keys`; substitui `is_jbm`, `supplier_advance`, `bar_confirm_delivery` | `pedidos.public_code`, `pedidos.entrega_desejada`, `fulfillment_alerts.assignee_user_id` | `order_supplier_assignments` vem do arquivo anterior |
| `sql/pos_floor.sql` | `pos_tickets`, `pos_ticket_items`, `pos_bottles`, `pos_bottle_moves`, `pos_recipes`, `pos_recipe_lines`, `pos_idempotency`, `pos_sale_events`; RPCs `pos_*`; policies só de `SELECT` | `pos_vendas`, `pos_vendas_itens`, `produtos.volume_ml`, `caixa_movimentos.operational_day` | `pos_vendas`, `pos_vendas_itens`, `caixa_movimentos`, `estoque_movimentos`, `drink_menu`, `bar_pricing`, `drink_back_agents` |
| `sql/payroll.sql` | `payroll_rules`, `payroll_periods`, `payroll_lines`, `payroll_audit`, `payroll_shift_plans`, `payroll_occurrences`, `payroll_points`, `payroll_goal_notes`, `payroll_rewards`, `payroll_advances`, `payroll_deductions` | nenhuma | `time_clock`, `perfis` |
| `sql/verify_schema.sql` | nada; só lê | nada | nada |

`sql/master_schema.sql` só inclui os outros arquivos com `\ir`. Não cria o catálogo.

Fora da instalação, de propósito: `seed_usuarios.sql` (o comentário aponta o projeto protegido e grava `auth.users`), `RESET_UMEOKAGROUP.sql`, `NOVO_BAR.sql`. `NOVO_BAR.sql` faz `INSERT` em `bars`. Não faz `CREATE TABLE`.

## Origem do catálogo legado

Não há `CREATE TABLE` para `bars`, `perfis`, `produtos`, `pedidos`, `pedidos_itens`, `vendas`, `vendas_itens`, `pos_vendas`, `pos_vendas_itens`, `caixa_movimentos`, `fornecedores`, `fornecedor_precos`, `compras`, `compras_itens`, `faturas`, `fatura_pagamentos`, `ryoshusho`, `notificacoes`, `estoque_movimentos`, `estoque_regras`, `drink_menu`, `bar_pricing`, `discount_codes`, `vip_members`, `vip_usages`, `drink_back_agents`, `bar_spaces`, `bar_guests`, `bar_visits`, `bar_bottle_keeps`, `pos_settings`, `pos_shifts`, `time_clock`, `bar_hq_meta`, `bar_overhead`.

Também não há `CREATE VIEW` para `produtos_public`. `sql/verify_schema.sql` marca esses nomes como legado ausente neste repositório.

A cópia em `atomic-bar-pos/migration.sql` repete só o cast. Não é um schema completo.

Não existe, neste repositório, um dump ou um arquivo que seja a origem instalável desse catálogo. Copiar o banco de produção está fora desta auditoria e continua proibido.

## Matriz de dependências

```
plataforma Supabase (auth.users, auth.uid)     [não está no git]
        │
        ▼
catálogo legado                                 [ausente no git]
  bars, perfis, produtos, pedidos, pedidos_itens
  vendas, vendas_itens
  pos_vendas, pos_vendas_itens
  caixa_movimentos, estoque_movimentos
  fornecedores, drink_menu, bar_pricing
  drink_back_agents, bar_spaces, time_clock
        │
        ▼
migration.sql
  exige vendas, caixa_movimentos, produtos
  cria cast_members antes da FK vendas.cast_id
        │
        ▼
sql/pos_sale_security.sql
  exige perfis, produtos, vendas, vendas_itens, cast_members
        │
        ├─────────────────────────────┐
        ▼                             │
sql/supplier_fulfillment.sql          │
  exige fornecedores, pedidos,        │
  pedidos_itens, produtos, perfis     │
        │                             │
        ▼                             │
sql/procurement.sql                   │
  exige order_supplier_assignments    │
  e fulfillment_alerts                │
        │                             │
        ▼                             │
sql/pos_floor.sql ◄───────────────────┘
  exige pos_require_bar → user_can_access_bar
  escreve pos_vendas, caixa_movimentos, estoque_movimentos
  lê drink_menu, bar_pricing, drink_back_agents, produtos
        │
        ▼
sql/payroll.sql
  lê time_clock se a tabela existir
        │
        ▼
sql/verify_schema.sql
```

Rodar `supplier_fulfillment.sql` de novo depois de `procurement.sql` repõe `supplier_advance`, `bar_confirm_delivery` e a policy antiga de alerta. A ordem não pode ser invertida.

## Colunas que o SQL novo já usa e que a tabela nova não define

Isto não é um `CREATE TABLE`. É o contrato já escrito nos `INSERT` e `SELECT`. Num banco vazio essas tabelas não existem, então a lista não pode ser aplicada.

`pos_close_ticket` grava em `pos_vendas`: `bar_id`, `data`, `subtotal`, `desconto_total`, `total`, `metodo_pagamento`, `tipo`, `criado_por`, `comissao_valor`, `drink_back_agent_id`, `card_fee`. O mesmo arquivo acrescenta `comissao_estornada`, `void_status`, `refunded`, `card_fee_reversed`.

Em `pos_vendas_itens`: `pos_venda_id`, `drink_menu_id`, `produto_id`, `nome`, `qtd`, `preco_unitario`, `preco_lista`, `tipo_preco`, `desconto_valor`, `for_cast`, `comissao_valor`, `refunded_qtd`, `stock_mode`.

Em `caixa_movimentos`: `bar_id`, `tipo`, `valor`, `descricao`, `referencia_id`, `referencia_tipo`, `data`, `operational_day`.

Em `estoque_movimentos`: `produto_id`, `bar_id`, `tipo`, `qtd`, `criado_por`, `obs`.

Em `drink_menu`: `id`, `bar_id`, `preco_venda`, `nome`.

Em `bar_pricing`: `produto_id`, `bar_id`, `preco_drink`.

Em `drink_back_agents`: `id`, `bar_id`, `ativo`, `comissao_pct`.

`payroll_my_pack` lê `time_clock` com `id`, `bar_id`, `punched_at`, `tipo`, `staff_id`. Se a tabela não existe, a função devolve lista vazia. Se existir com outros nomes de coluna, a função quebra: a exceção capturada é só `undefined_table`.

`pos_tickets.bar_id`, `pos_bottles.bar_id` e `pos_idempotency.bar_id` não têm `REFERENCES bars`. `pos_ticket_items.ticket_id` referencia `pos_tickets`. `pos_ticket_items.drink_menu_id` e `produto_id` não referenciam `drink_menu` nem `produtos`.

## Plano para um banco vazio

1. Criar um projeto Supabase novo, fora de `ojirgkqtqvugqktyuhem` e `fxsakrshmldmkdmbevna`.
2. Parar. O passo seguinte exigiria o DDL do catálogo legado, e esse DDL não está no repositório. Não copiar produção. Não rodar `seed_usuarios.sql`.
3. Só depois de existir um DDL revisado, escrito para esse projeto e sem dados reais: criar as tabelas legado vazias, com as colunas citadas acima.
4. Criar usuários só nesse Auth e linhas `perfis` com `id = auth.uid()` e `bar_id` desse projeto.
5. Aplicar, um arquivo por vez: `migration.sql`, `sql/pos_sale_security.sql`, `sql/supplier_fulfillment.sql`, `sql/procurement.sql`, `sql/pos_floor.sql`, `sql/payroll.sql`.
6. Rodar `sql/verify_schema.sql`. A linha `SUMMARY` precisa ser `OK`, inclusive nas linhas `legacy-table`.
7. Só então preencher Preview com URL, anon key e as duas flags de autorização. `assertMayWrite` continua em `STAGING_NOT_CONNECTED` até existir um writer. O demo do navegador não deve ser desligado antes disso.

## Isolamento e papéis

`user_can_access_bar` permite `admin` em qualquer bar, e `cliente`, `gerente`, `caixa`, `bar_staff` só quando `perfis.bar_id` é o bar pedido. `cliente` aqui é o papel antigo do dono do bar.

`funcionario`, `fornecedor`, `staff` e `jbm` não passam nessa função.

`pos_require_bar` acrescenta `jbm`. O `jbm` chama a RPC e a policy de `SELECT` continua em `user_can_access_bar`, então o `jbm` não lê as tabelas do piso direto.

`fornecedor` entra por `supplier_users`, não por `perfis.bar_id`.

`get_my_procurement_tasks` exige `admin`, `jbm` ou `funcionario` e filtra tarefas por `assigned_to = auth.uid()`. A mesma função devolve todas as `locations` ativas dos tipos `WAREHOUSE`, `STORE`, `SUPPLIER` e `OTHER`, sem filtro de bar.

Não há tabela `organizations`.

## SECURITY DEFINER

As funções novas usam `SET search_path = public` e `REVOKE ALL ... FROM PUBLIC` seguido de `GRANT EXECUTE ... TO authenticated`. Não há `GRANT` para `anon` nem `service_role` nesses arquivos.

`pos_close_ticket` lê o preço em `drink_menu.preco_venda` ou `bar_pricing.preco_drink`. O total enviado pelo browser não entra no `INSERT`. `desconto_total` é gravado como `0`.

`pos_require_bar` rejeita `auth.uid()` nulo e bar fora do perfil. `deduct_stock` exige quantidade positiva e o mesmo acesso ao bar.

Quem passa em `pos_require_bar` também pode estornar (`pos_void_sale`) e registrar waste. Não há permissão separada para isso. Caixa e `bar_staff` estão nesse conjunto.

`payroll_my_pack` exige sessão e filtra o ponto por `staff_id = auth.uid()`. A folha HQ exige `admin` ou `jbm`.

## Idempotência, concorrência e transação

`pos_idempotency` tem chave primária `(bar_id, key)`. A segunda chamada com a mesma chave devolve a venda se `venda_id` já estiver preenchido, ou `close in progress` se a linha existir sem venda. A inserção da chave e a venda estão na mesma função. Uma falha posterior desfaz as duas, porque o Postgres trata a função como uma transação, salvo exceção capturada.

Estoque e garrafa usam `pg_advisory_xact_lock` e `FOR UPDATE`. Duas vendas da última unidade não baixam as duas.

`order_idempotency_keys` existe no procurement. O teste em `scripts/procurement.test.mjs` cobre a regra em memória e no texto SQL. Não houve execução no banco.

O módulo `src/lib/operationalTransactions.js` não é chamado por essas funções SQL. Ligar o Preview não ativa esse módulo.

## Incompatibilidade entre o demo e o SQL do piso

O demo aplica desconto por `pos_apply_discount` em `src/lib/localDemoClient.js`. Não existe `pos_apply_discount` em `sql/`. No staging essa RPC não existe, e `pos_close_ticket` grava desconto zero.

No demo, só o pagamento em dinheiro aumenta o caixa esperado. Em `pos_close_ticket`, todo pagamento gera `caixa_movimentos` do tipo `entrada` pelo subtotal, e cartão ainda gera uma `saida` da taxa de 3,78%.

O demo aumenta estoque na entrega do pedido do fornecedor. O SQL do piso baixa `estoque_movimentos` na venda e não lê o ledger do browser.

`pos_tickets` não tem coluna de desconto. Uma comanda aberta no demo não tem o mesmo formato da comanda SQL.

## Riscos

| Gravidade | Risco |
| --- | --- |
| Bloqueante | Não há DDL do catálogo legado. Um banco vazio não completa a primeira migration. |
| Bloqueante | `sql/verify_schema.sql` marca essas tabelas como ausentes. `SUMMARY` não fica `OK`. |
| Bloqueante | Não há writer de staging. Autorizar o Preview não cria as tabelas nem liga `acceptStagingCommand` ao Postgres. |
| Alto | `pos_apply_discount` existe só no demo. O fechamento SQL zera o desconto. |
| Alto | Caixa do demo e `caixa_movimentos` do SQL não usam a mesma regra para cartão. |
| Alto | Colunas de `bar_id` do piso não referenciam `bars`. Um UUID qualquer pode ser gravado se a RPC for contornada por um papel que ela aceita. |
| Alto | `jbm` executa as RPCs do piso em qualquer bar. O `SELECT` direto não acompanha esse acesso. |
| Médio | Caixa e `bar_staff` podem estornar e lançar waste. |
| Médio | `get_my_procurement_tasks` lista locais de depósito e fornecedor para o funcionário. |
| Médio | `payroll_my_pack` esconde tabela ausente e quebra se `time_clock` existir com outras colunas. |
| Médio | Rodar o fulfillment outra vez depois do procurement desfaz funções já substituídas. |
| Baixo | Não há `CREATE EXTENSION`. Um Postgres sem `gen_random_uuid` falha nos `DEFAULT`. O Supabase costuma oferecer essa função; este repositório não a garante. |
| Baixo | O demo continua correto no browser e não prova o SQL. |

## Testes

Já existem e não abrem banco: `npm run test:readiness`, `npm run test:supabase`, `npm run test:demo`, `npm run test:pos`, `npm run test:procurement`, `npm run test:payroll`, `npm run test:legacy`. `npm run test:pos:pg` não faz nada sem `POS_PG_TEST_URL` de um banco cujo nome termina em `_test` e que não seja `supabase.co`.

Ainda não existem, e só fazem sentido depois do DDL legado e de um Postgres de teste local, não do projeto protegido:

- `migration.sql` falha de forma explícita quando `vendas` não existe, e passa quando o catálogo mínimo existe.
- `verify_schema.sql` devolve `SUMMARY = OK` nesse banco.
- Dono do bar A não lê venda, estoque nem comanda do bar B.
- `funcionario` e `fornecedor` não executam `pos_close_ticket`.
- A mesma chave de fechamento devolve a mesma venda e não baixa estoque duas vezes.
- Duas sessões na última unidade: uma vende, a outra recebe `insufficient stock`.
- Cartão e dinheiro produzem os movimentos de caixa que o teste declarar, iguais entre si no código e no banco.
- Desconto: ou a RPC existe e o total gravado é o total do servidor, ou o teste documenta que o fechamento SQL recusa desconto.
- Ponto duplicado não cria dois turnos abertos.
- Entrega de fornecedor recebida duas vezes não soma estoque duas vezes.
- `payroll_my_pack` de um funcionário não devolve o ponto de outro.

Homologação manual, só no projeto novo, com usuários fictícios:

1. Confirmar que a URL do Preview não contém os dois refs protegidos.
2. Entrar como gerente do bar de teste, abrir uma mesa, vender um item com receita, ver a baixa e o recibo.
3. Repetir o pagamento com a mesma chave e conferir uma única linha em `pos_vendas` e uma única baixa.
4. Fechar o caixa e conferir a soma de `caixa_movimentos` da noite.
5. Entrar como fornecedor de teste, avançar um pedido e conferir que o estoque do bar só muda na etapa definida pelo teste.
6. Entrar como funcionário, bater o ponto, e conferir que outro funcionário não vê esse ponto.
7. Entrar como gerente de outro bar e confirmar que a comanda e o caixa do primeiro não aparecem.

## Critérios para liberar a conexão

Todos precisam ser verdadeiros ao mesmo tempo:

- O projeto novo não é nenhum dos dois refs protegidos.
- `sql/verify_schema.sql` nesse projeto devolve `SUMMARY` `OK`, incluindo as linhas `legacy-table`.
- Existe DDL revisado, no repositório, das tabelas que hoje estão só como “ausente”. Esta auditoria não o escreveu.
- Um teste Postgres local, fora do Supabase de produção, cobre isolamento, idempotência da venda, estoque concorrente e caixa.
- Preview tem `VITE_DEPLOY_CHANNEL=preview`, URL e anon key do projeto novo, `VITE_ATOMIC_STAGING_AUTHORIZED=1` e `ATOMIC_STAGING_AUTHORIZED=1`.
- Production não foi alterado.
- O demo do browser continua disponível quando essas variáveis estão ausentes.

Enquanto o DDL legado não existir no repositório, a conexão de staging permanece bloqueada.
