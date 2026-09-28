# Arquitetura

O produto é o caminho do drink, não só um caixa.

```
BAR pede
  → JBM planeja
  → PROCUREMENT escolhe fonte
  → SUPPLIER cumpre
  → PURCHASE registra custo
  → WAREHOUSE recebe
  → SHIPMENT manda para aquele bar
  → BAR confirma
  → INVENTORY soma estoque_movimentos daquele bar
  → POS vende em pos_vendas
```

`vendas` é a conta da JBM com o bar. Não é o caixa.

## Peças

**Auth.** `auth.users` e `perfis`. Um perfil, um bar, um papel. Ver `docs/security-model.md`.

**HQ.** Admin e jbm operam pedidos, compras, fulfillment e folha da plataforma. Não substituem o gerente do bar.

**Supplier.** Vê a própria tarefa. Não vê margem, custo JBM nem outro supplier.

**POS.** `PosFloor` para celular e tablet. Motor em `src/lib/posEngine.js`. Fechamento em `pos_close_ticket`. Detalhe em `docs/pos-ux-architecture.md`.

**Inventory.** Saldo do bar é a soma de `estoque_movimentos` daquele `bar_id` e `produto_id`. `produtos.estoque_atual` é legado global e não é o saldo do bar.

**Procurement.** Catálogo `produtos` é global. Preço de venda ao bar é `bar_product_prices`. Reposição é `replenishment_rules`. Fonte é `procurement_source_products`, sem `bar_id`.

**Payroll.** `perfis` → `time_clock` → `payroll_lines`. Desativar funcionário não apaga lançamento. O ponto ainda não existe em produção.

**CRM.** `bar_guests` é cliente da casa. `bar_visits` liga mesa, convidado e `pos_vendas`. Não é o papel `cliente`.

**AI.** Cards por bar em `pos_bar_config`. Sem chat. Sem produto inventado.

**Floor.** `bar_spaces` é a mesa. A comanda aberta é `pos_tickets`. Comanda que não está `open` não recebe item.

## O que não criar de novo

Segundo catálogo, segundo pedido, segundo POS, segunda autenticação, segunda senha, segundo caixa.

A diferença entre o banco de produção e este desenho está em `docs/database-compatibility-matrix.md`. A ordem da migration está em `docs/database-architecture-resolution.md`.
