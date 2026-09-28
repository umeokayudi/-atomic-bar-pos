# Matriz de compatibilidade do banco

Três colunas de fato, mais o estado.

- **Frontend** é o que `src/` e `api/` leem ou gravam.
- **SQL** é o que os arquivos deste repositório criam ou alteram.
- **Produção** é o que a auditoria read-only anterior viu em `ojirgkqtqvugqktyuhem`. O que não apareceu está como ausente. Policy, índice e trigger de produção continuam desconhecidos. Esta passagem não consultou o banco.

Não executar estes scripts em produção.

| Feature | Frontend expects | SQL provides | Production has | Status |
|---|---|---|---|---|
| `produtos` catálogo | sim, sem `bar_id` | sem `CREATE`; `deduct_stock` ainda filtra `bar_id` | sim, sem `bar_id`, com `volume_ml` e estoque global | CONFLITO no SQL antigo; decisão: não adicionar `bar_id` |
| Preço de balcão | `bar_pricing`, `drink_menu` | sem `CREATE` | não provado naquela leitura | BLOQUEADO até verificar |
| Preço JBM por bar | `bar_product_prices` | `sql/procurement.sql` | ausente | SQL pronto, não instalado |
| Estoque do bar | `estoque_movimentos.bar_id` | sem `CREATE` da tabela | sim, com `bar_id` | OK como livro; não usar `estoque_atual` |
| `vendas` conta JBM | `bar_id`, `data`, `total`, itens | `create_order` pede colunas de balcão | existe; faltam `forma_pagamento`, `mesa`, `status`, `origem` | NÃO adicionar colunas de caixa |
| `pos_vendas` | caixa do bar | `ALTER` em `pos_floor.sql`, sem `CREATE` | ausente | BLOQUEADO; criar antes de alterar |
| `pos_close_ticket` | fechamento numa transação | `sql/pos_floor.sql` | ausente | BLOQUEADO |
| `pos_bar_config` | favoritos, IA, taxas | `sql/pos_ux.sql` | ausente | SQL pronto, não instalado |
| `caixa_movimentos.bar_id` | piso grava bar, tipo e referência | `ALTER` no piso e na migration | só `id`, `tipo`, `valor`, `data`, `descricao` | MIGRATION aditiva; sem backfill |
| `bar_spaces`, `bar_guests`, `bar_visits` | piso e CRM | sem `CREATE` | ausentes | BLOQUEADO; colunas já listadas na arquitetura |
| `time_clock` | ponto | sem `CREATE` | ausente | BLOQUEADO |
| `payroll_*` | folha | `sql/payroll.sql` | ausente | Instalável; hora vazia sem ponto |
| `bar_employees` | convite e status | `sql/bar_employees.sql` | ausente | SQL pronto; não é segundo usuário |
| Fulfillment / procurement | HQ e supplier | `sql/supplier_fulfillment.sql`, `sql/procurement.sql` | ausentes | Instaláveis à parte; não formam o caixa |
| RLS e policies | isolamento por bar | nos scripts novos | desconhecido | NÃO assumir que produção está protegida |
| `perfis` | um login, um bar, um papel | sem `CREATE` | existe; faltam `cargo`, `salario_hora`, `ativo`, `clock_pin_hash` | Não criar outra tabela de usuário |

## Migrations ainda necessárias

Uma migration, na ordem já decidida em `docs/database-architecture-resolution.md`, e só depois `sql/pos_ux.sql`.

1. Não adicionar `produtos.bar_id`.
2. Não instalar `deduct_stock` nem `create_order` como estão.
3. Adicionar em `caixa_movimentos`: `bar_id` anulável, `referencia_tipo`, `referencia_id`, `operational_day`. Sem `UPDATE` de histórico.
4. Criar `pos_vendas` e `pos_vendas_itens` antes de qualquer `ALTER`.
5. Criar `bar_spaces`, `bar_guests`, `bar_visits`, `drink_menu` e `bar_pricing` se a próxima leitura confirmar ausência.
6. Criar `time_clock` com `staff_id` → `perfis`.
7. Aplicar fulfillment, procurement, payroll e `bar_employees` como objetos novos.
8. Aplicar `sql/pos_ux.sql` depois do piso, para `pos_bar_config`, `pos_quote_charges` e `pos_close_with_charges`.

Nada disso foi executado.
