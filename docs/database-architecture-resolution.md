# Resolução de arquitetura do banco

Decisão fechada antes de aplicar qualquer migration. Este arquivo não lê nem altera produção. Os fatos de produção vêm da auditoria read-only já feita em `ojirgkqtqvugqktyuhem`. O SQL revisável está em `sql/migration_final.sql` e não foi executado. Não houve deploy nem mudança de dados.

O princípio é um só: não duplicar produto, venda, caixa nem funcionário. Onde o código novo e a produção discordam, a produção manda na forma da tabela que já existe, e o código que exige uma coluna inexistente fica bloqueado até a migration planejada.

## A. Schema atual de produção

Confirmado pela auditoria read-only. O que não foi visto na API não é tratado como existente.

| Objeto | Presente | Colunas relevantes vistas | Ausente |
|---|---|---|---|
| `produtos` | sim | `estoque_atual`, `estoque_minimo`, `estoque_maximo`, `volume_ml` | `bar_id` |
| `vendas` | sim | `cast_id`, `comissao_total` | `forma_pagamento`, `mesa`, `status`, `origem` |
| `caixa_movimentos` | sim | `id`, `tipo`, `valor`, `data`, `descricao` | `bar_id`, `referencia_tipo`, `referencia_id`, `operational_day` |
| `estoque_movimentos` | sim | inclui `bar_id`, `criado_por`, `obs` | — |
| `pedidos` | sim | sem `public_code`, sem `entrega_desejada` | essas duas colunas |
| `fornecedores` | sim | `ativo` | `default_lead_time_hours`, `cutoff_time`, `delivery_days` |
| `perfis` | sim | sem `cargo`, `salario_hora`, `ativo`, `clock_pin_hash` na cache da API | essas colunas |
| `produtos_public` | sim | sem `bar_id` | — |
| `pos_vendas`, `pos_vendas_itens` | não | — | a tabela inteira |
| `bar_spaces`, `bar_guests`, `bar_visits` | não | — | a tabela inteira |
| `time_clock` | não | — | a tabela inteira |
| tabelas de fulfillment, procurement, piso (`pos_tickets` e seguintes), payroll, `bar_employees` | não | — | criadas só nos scripts deste repositório |

`bars`, `pedidos_itens`, `vendas_itens`, `compras`, `faturas`, `bar_pricing`, `fornecedor_precos`, `drink_menu` e `cast_members` entram no uso do código. A auditoria marcou `bar_pricing`, `drink_menu` e `cast_members` como não provados na cache da API daquela leitura. Não se assume que existam até a próxima verificação.

## B. Conflitos de arquitetura

1. `deduct_stock` e `create_order` filtram `produtos.bar_id`. Produção não tem essa coluna. O catálogo JBM (`Configs`, compras, fornecedores, procurement) lê `produtos` sem bar. São dois modelos no mesmo nome.
2. `sql/pos_floor.sql` faz `ALTER TABLE pos_vendas` e `pos_vendas_itens` antes de existir a tabela. Produção não tem essas tabelas. O caixa novo não grava em `vendas`.
3. `create_order` grava em `vendas` colunas de balcão (`forma_pagamento`, `mesa`, `status`) que produção não tem e que o caixa atual não usa.
4. `caixa_movimentos` de produção não tem `bar_id`. O piso grava `bar_id`, `referencia_tipo`, `referencia_id` e `operational_day`. Sem `bar_id` o caixa não é multi-tenant.
5. `produtos.estoque_atual` é um número só. O estoque do bar já tem livro em `estoque_movimentos.bar_id`. Usar a coluna global como estoque do bar mistura bares.
6. `time_clock` não existe. A folha só lê essa tabela. O funcionário já é `perfis`, não uma tabela nova.
7. `verify_schema.sql` trata `pos_vendas` como tabela legada “sem CREATE neste repositório”. Em produção ela não é legada: está ausente. A migration planejada tem de criá-la. O verificador atual não serve como lista de instalação até ser alinhado com este documento.

### Matriz `bar_id`

“Tem” significa o que a auditoria read-only viu ou o que o app já filtra com sucesso em produção. “Deve ter” é a decisão desta arquitetura. Tabela ausente conta como não tem.

| Objeto | Tem `bar_id` | Deve ter `bar_id` | Motivo |
|---|---|---|---|
| `produtos` | não | não | Catálogo global. `atomic-bar-pos/src/pages/POS.jsx` ainda filtra `produtos.bar_id`; esse arquivo é o caixa antigo e não define o modelo. O app atual (`Configs`, compras, fornecedores, procurement) lê `produtos` sem bar |
| `vendas` | sim | sim | Conta da JBM com o bar. `pedidoVenda.js` e `Vendas.jsx` gravam `bar_id` |
| `vendas_itens` | não | não | O bar chega por `venda_id` → `vendas.bar_id` |
| `caixa_movimentos` | não | sim, anulável | O piso grava o caixa do bar. `Cashflow.jsx` e `Compras.jsx` gravam movimento da JBM sem bar. `NOT NULL` quebraria o caixa da holding |
| `estoque_movimentos` | sim | sim | Este é o livro de estoque lacrado por bar. A auditoria viu `bar_id` |
| `pedidos` | sim | sim | Encomenda de um bar. `posSupply.js` grava `bar_id` |
| `pedidos_itens` | não | não | O bar chega por `pedido_id` → `pedidos.bar_id` |
| `perfis` | sim | sim para login de bar; nulo para `admin` e `jbm` | Um perfil, um bar. `user_can_access_bar` já compara `perfis.bar_id` |
| `cast_members` | tabela não provada | sim, quando for criada | Comissão antiga, não login. `migration.sql` já desenha `bar_id NOT NULL`. Não substitui `perfis` |
| `time_clock` | tabela ausente | sim | Ponto daquele login naquele bar. `staff_id` = `perfis.id` |
| `bar_spaces` | tabela ausente | sim | Mesa ou sala de um bar. Não é `vendas.mesa` |
| `pos_vendas` | tabela ausente | sim | Caixa do bar. Tabela nova, não é `vendas` |
| procurement | misto, tabelas ausentes | só no fato que é do bar | `procurement_source_products` é fonte × produto global, sem `bar_id`. `bar_product_prices` e `replenishment_rules` têm `bar_id`. `locations.bar_id` só quando `type = 'BAR'`. `procurement_routing_rules.destination_bar_id` é o destino, não uma cópia do produto. `procurement_stock_moves` usa `location_id` |

## C. Produto e bar

**Decisão: `produtos` é catálogo global. Não receberá `bar_id`.**

Um produto é uma garrafa ou um item comprado pela JBM e vendido a vários bares. Duplicar a linha por bar duplicaria compras, fornecedor e procurement.

O que muda por bar fica fora de `produtos`:

| Fato | Onde fica | Por quê |
|---|---|---|
| Identidade do produto (nome, categoria, custo de referência, `volume_ml`) | `produtos` | é o mesmo SKU para todos os bares. `volume_ml` já está em produção e é tamanho da garrafa, não estoque do bar |
| Preço que o cliente paga no balcão | `bar_pricing` (`bar_id`, `produto_id`, `preco_drink`, `drinks_por_garrafa`) | o piso lê este par em `pos_close_ticket` |
| Preço que a JBM cobra do bar | `bar_product_prices` (`bar_id`, `product_id`, `sale_price`) | pedido e margem. Não substitui `bar_pricing` |
| Custo do fornecedor | `fornecedor_precos` | preço de compra, não preço do bar |
| Quem pode fornecer o SKU | `procurement_source_products` (`product_id` global) | fonte de compra, não estoque do bar |
| Cardápio com nome de drink | `drink_menu` com `bar_id` | o drink é do bar; a receita aponta para o produto global |
| Estoque lacrado | soma de `estoque_movimentos` onde `bar_id` e `produto_id` | `pos_sealed_units` já faz essa conta |
| Garrafa aberta | `pos_bottles` (`bar_id`, `produto_id`) | ml restante, criada pelo piso |
| Mínimo para repor naquele bar | `replenishment_rules` (`bar_id`, `product_id`) | já desenhada no procurement. Não copiar `estoque_minimo` de `produtos` |

Não há tabela nova de produto. Não há `bar_stock` obrigatória: o saldo é o livro `estoque_movimentos`. Uma tabela de saldo seria cache e fica fora da primeira migration.

`produtos.estoque_atual`, `estoque_minimo` e `estoque_maximo` permanecem colunas globais legadas. A migration não as apaga e não as usa como estoque do bar. `deduct_stock` não pode ser instalado enquanto subtrair `produtos.estoque_atual` filtrando `bar_id`.

## D. Modelo de vendas do POS

Existem dois livros. Não se fundem.

### `vendas` — conta da JBM com o bar

O que o código de compras/entregas grava hoje (`src/lib/pedidoVenda.js`, `src/components/Vendas.jsx`):

- `bar_id`, `data`, `data_venda`, `total`, `obs`, `criado_por`
- itens: `venda_id`, `produto_id`, `qtd`, `preco_unitario`
- `origem` é opcional. O código já retira o campo se a coluna não existir. Não é obrigatório.

`cast_id` e `comissao_total` já existem em produção por causa do caixa antigo. Ficam. Não se adiciona `forma_pagamento`, `mesa` nem `status` para fazer o caixa caber nesta tabela. `create_order` em `sql/pos_sale_security.sql` está no modelo errado: grava balcão dentro de `vendas` e exige `produtos.bar_id`. Esse função não entra na migration até ser reescrita para o livro JBM, ou ser deixada de fora porque o piso não a chama.

O piso novo (`PosFloor`) chama `pos_close_ticket`. Não chama `create_order`.

| | `vendas` |
|---|---|
| CURRENT | Existe. Colunas usadas pelo app: `bar_id`, `data`, `data_venda`, `total`, `obs`, `criado_por`, `cast_id`, `comissao_total`. Sem `forma_pagamento`, `mesa`, `status`, `origem` |
| REQUIRED | As colunas que o app já grava. `origem` continua opcional: `pedidoVenda.js` retira o campo se a coluna não existir. `cast_id` e `comissao_total` ficam porque já estão em produção |
| MIGRATION | Nenhuma coluna de balcão. Não adicionar `forma_pagamento`, `mesa` nem `status`. `origem` só entra se a fatura automática precisar do valor `'fornecedor'`; não é requisito do caixa |

| | `vendas_itens` |
|---|---|
| CURRENT | Existe. O app grava `venda_id`, `produto_id`, `qtd`, `preco_unitario` |
| REQUIRED | Essas quatro. Sem `bar_id` |
| MIGRATION | Nenhuma coluna nova |

### `pos_vendas` — caixa do bar

Não existe em produção e não equivale a `vendas`. É tabela nova. O `ALTER` no topo de `sql/pos_floor.sql` falha enquanto a tabela não existir. A migration planejada cria a tabela com as colunas que os dois escritores usam, e o `ALTER` posterior vira redundante.

`pos_close_ticket` grava:

- `pos_vendas`: `bar_id`, `data`, `subtotal`, `desconto_total`, `total`, `metodo_pagamento`, `tipo`, `criado_por`, `comissao_valor`, `drink_back_agent_id`, `card_fee`
- `pos_vendas_itens`: `pos_venda_id`, `drink_menu_id`, `produto_id`, `nome`, `qtd`, `preco_unitario`, `preco_lista`, `tipo_preco`, `desconto_valor`, `for_cast`, `comissao_valor`, `refunded_qtd`, `stock_mode`

O caixa anterior (`commitPosSale`) também grava, quando a coluna existe: `vip_member_id`, `discount_code_id`, `obs`, `space_id`, `guest_id`, `visit_id`. O estorno e o fechamento da noite leem `void_status`, `refunded`, `comissao_estornada`, `card_fee_reversed`.

`data` é a noite operacional (antes das 06:00 em Tóquio pertence à noite anterior). Não é `vendas.data`.

| | `pos_vendas` |
|---|---|
| CURRENT | Ausente. Não há equivalente em `vendas` |
| REQUIRED | `bar_id`, `data`, `subtotal`, `desconto_total`, `total`, `metodo_pagamento`, `tipo`, `criado_por`, `comissao_valor`, `drink_back_agent_id`, `card_fee`. O estorno lê `void_status`, `refunded`, `comissao_estornada`, `card_fee_reversed`. `commitPosSale` também grava, e recua se a coluna faltar: `vip_member_id`, `discount_code_id`, `obs`, `space_id`, `guest_id`, `visit_id` |
| MIGRATION | `CREATE TABLE` com o conjunto REQUIRED antes de qualquer `ALTER`. O `ALTER` do topo de `sql/pos_floor.sql` deixa de ser o primeiro passo |

| | `pos_vendas_itens` |
|---|---|
| CURRENT | Ausente |
| REQUIRED | `pos_venda_id`, `drink_menu_id`, `produto_id`, `nome`, `qtd`, `preco_unitario`, `preco_lista`, `tipo_preco`, `desconto_valor`, `for_cast`, `comissao_valor`, `refunded_qtd`, `stock_mode` |
| MIGRATION | `CREATE TABLE` junto com `pos_vendas`. Sem `bar_id`: a venda pai já tem |

### `caixa_movimentos`

Continua a única tabela de caixa. Não se cria outra.

| | |
|---|---|
| CURRENT | `id`, `tipo`, `valor`, `data`, `descricao` |
| REQUIRED | os atuais, mais `bar_id`, `referencia_tipo`, `referencia_id`, `operational_day` |
| MIGRATION | `ADD COLUMN` só desses quatro. `data` continua o instante real. `operational_day` é a noite do caixa. Linhas antigas ficam com `bar_id` nulo até uma decisão humana de backfill. Esta tarefa não faz `UPDATE`. |

## E. Estoque

| | |
|---|---|
| CURRENT | `produtos.estoque_atual` global. `estoque_movimentos` com `bar_id` |
| REQUIRED | saldo do bar = soma de `estoque_movimentos` (`entrada` positivo, resto negativo) por `bar_id` + `produto_id`. Garrafa aberta em `pos_bottles`. Movimento de depósito JBM em `procurement_stock_moves` por `location_id`, não por uma segunda coluna em `produtos` |
| MIGRATION | não adicionar `produtos.bar_id`. Não mover `estoque_atual` para uma tabela nova nesta fase. `volume_ml` já existe; o `ALTER` de `pos_floor.sql` é inócuo se a coluna estiver lá |

`deduct_stock` de três argumentos, que baixa `produtos.estoque_atual` com `bar_id`, não é instalado.

## F. Funcionário e autenticação

Uma identidade. Nenhuma tabela nova de usuário.

```
auth.users
    ↓  mesmo uuid
perfis                      perfil. id = auth.uid()
    ↓
perfis.bar_id               o bar deste login (um bar por perfil)
    ↓
perfis.role                 permissão: cliente, gerente, caixa, bar_staff
                            (admin e jbm não são funcionários do bar)
    ↓
bar_employees.job_role      título: manager, cashier, bartender, hostess, staff, cleaner
                            só quando sql/bar_employees.sql for aplicado
                            permission_role continua sendo o role acima
```

`cast_members` não é funcionário. É a lista antiga de comissão do `create_order`, com `bar_id` próprio. Não vira login e não substitui `perfis`. A comissão do piso novo usa `drink_back_agents` e `pos_vendas.drink_back_agent_id`.

`time_clock.staff_id` e `payroll_lines.employee_id` são `perfis.id`. Não há outro id de pessoa.

Senha fica no Supabase Auth. Não há coluna de senha.

## G. Piso, mesa e cliente

Estas tabelas não estão em produção e não têm `CREATE` no repositório. A migration planejada cria só as colunas que o frontend já envia.

### `bar_spaces`

Uma mesa ou sala pertence a um bar. Não é `vendas.mesa`.

Colunas escritas ou lidas: `id`, `bar_id`, `nome`, `tipo` (`counter`, `table`, `vip_room`), `zona`, `capacidade`, `ordem`, `notas`, `ativo`.

Relação: `bar_spaces.bar_id` → `bars`. A comanda aberta é `pos_tickets.space_id`. A venda do caixa aponta `pos_vendas.space_id`. Não há tabela `mesas` separada.

### `bar_guests`

Cliente da casa, não o role `cliente` do login.

Colunas: `id`, `bar_id`, `nome`, `telefone`, `line_id`, `email`, `aniversario`, `preferencias`, `alergias`, `notas`, `preferred_host`, `tags`, `vip_member_id`, `ativo`, `atualizado_em`.

### `bar_visits`

Uma presença numa mesa.

Colunas: `id`, `bar_id`, `space_id`, `guest_id`, `status` (`seated`, `reserved`), `party_size`, `inicio`, `fim`, `host_nome`, `pos_venda_id`, `criado_por`.

`space_id` → `bar_spaces`. `guest_id` → `bar_guests`. `pos_venda_id` → `pos_vendas`, quando o caixa fecha. `criado_por` → `perfis.id`.

O piso carrega a comanda por `pos_load_ticket(bar, space)`. Sem `bar_spaces` não há mesa. Sem `pos_vendas` a visita não liga à venda.

## H. Ponto e folha

```
perfis.id
    → time_clock.staff_id     ponto daquele login naquele bar
    → payroll_lines.employee_id
```

`time_clock` não existe. Enquanto não existir, `payroll_my_pack` devolve ponto vazio de propósito (`undefined_table`). A folha não calcula hora real sem esta tabela.

Colunas que o relógio grava (`api/_routeTimeClock.js`) e que a folha lê:

`id`, `bar_id`, `staff_id`, `tipo` (`in` ou `out`), `punched_at`, `lat`, `lng`, `accuracy_m`, `distance_m`, `tablet_ok`, `origem` (`hq`, `app`, `tablet`).

`staff_id` é `perfis.id` do mesmo bar (`perfis.bar_id = time_clock.bar_id`). Não se cria empregado dentro do ponto.

As tabelas `payroll_*` são livro de pagamento. `employee_id` não tem outra origem. `bar_id` na linha de folha diz em qual bar aquela verba ocorreu. O período (`payroll_periods`) é da operação, não um segundo cadastro de gente.

## I. O que a migration planejada precisa fazer

Uma migration, nesta ordem lógica. O SQL revisável está em `sql/migration_final.sql`. Ele foi desenhado e não foi executado.

1. Não adicionar `produtos.bar_id`.
2. Não instalar `deduct_stock` nem `create_order` enquanto eles filtrarem `produtos.bar_id` ou gravarem balcão em `vendas`.
3. `caixa_movimentos`: adicionar `bar_id`, `referencia_tipo`, `referencia_id`, `operational_day`. Sem backfill automático.
4. Criar `pos_vendas` e `pos_vendas_itens` com as colunas da seção D, antes de qualquer `ALTER` dessas tabelas.
5. Criar `bar_spaces`, `bar_guests`, `bar_visits` com as colunas da seção G, todas com `bar_id`.
6. Criar `time_clock` com as colunas da seção H. `staff_id` referencia `perfis(id)`.
7. Estoque do bar continua `estoque_movimentos`. Não criar saldo paralelo.
8. `bar_pricing` e `bar_product_prices` permanecem os dois preços diferentes. Se `bar_pricing` não existir em produção, a migration cria o par `bar_id` + `produto_id` + preço de balcão. Não copia esse preço para `produtos.preco_venda`.
9. `drink_menu` por bar, se ausente, entra na mesma migration porque o piso não fecha drink sem ele e sem `pos_recipes`.
10. Funcionário continua `perfis`. `bar_employees` só acrescenta título e status. Não é outro usuário.
11. RLS de cada tabela nova usa `user_can_access_bar(bar_id)` ou o gate JBM já existente. Menu escondido não é autorização.
12. Só depois disso os scripts atuais de piso, folha e convite podem rodar, e o `ALTER` inicial de `pos_vendas` deixa de ser o primeiro passo.

## J. O que pode ser instalado sem redesenho

Objetos novos, que referenciam `produtos(id)` global e não alteram `produtos.bar_id`:

- Tabelas e políticas de `sql/supplier_fulfillment.sql` (pedidos, fornecedores, `audit_logs`).
- Tabelas de `sql/procurement.sql` (`procurement_source_products`, `bar_product_prices`, `replenishment_rules`, locais, embarques). O preço por bar mora aqui, não em `produtos`.
- Tabelas de `sql/payroll.sql`, sabendo que o ponto virá vazio até `time_clock` existir.
- `sql/bar_employees.sql`, desde que `perfis` exista. Não cria usuário.
- `cast_members` e `cast_comissoes` de `migration.sql`, se `bars` e `vendas` existirem. São comissão antiga, não login.

Mesmo esses scripts só entram na janela planejada. Não foram aplicados aqui.

## K. O que exige redesenho antes de instalar

- `migration.sql` e `sql/pos_sale_security.sql`: `deduct_stock` e `create_order`.
- O começo de `sql/pos_floor.sql`: `ALTER` em `pos_vendas` / `pos_vendas_itens` que ainda não existem. O miolo (tickets, garrafas, `pos_close_ticket`) está no modelo certo e espera a tabela criada na seção I.
- Tratar `produtos.estoque_*` como estoque do bar.
- Tratar `vendas` como caixa (`forma_pagamento`, `mesa`, `status`).
- `sql/verify_schema.sql` marcar `pos_vendas` como legado sem `CREATE`.
- Qualquer backfill de `caixa_movimentos.bar_id`. Linhas antigas não têm bar. Isso é decisão de dados, não de `ADD COLUMN`.

Não há segunda tabela de produto, de venda de balcão, de caixa nem de funcionário.

## L. Arquitetura final desta migration

`sql/migration_final.sql` é o único arquivo planejado para preparar produção. Ele junta o que as seções C–K já decidiram. Não foi aplicado em `ojirgkqtqvugqktyuhem` nem no holding.

Livros que permanecem separados:

| Livro | Tabela | Papel |
|---|---|---|
| Conta da JBM com o bar | `vendas` + `vendas_itens` | não recebe `forma_pagamento`, `mesa`, `status` nem `origem` |
| Caixa do bar | `pos_vendas` + `pos_vendas_itens` | criado antes de qualquer `ALTER` do piso |
| Movimento de caixa | `caixa_movimentos` | ganha `bar_id` anulável, `referencia_tipo`, `referencia_id`, `operational_day`. Sem `UPDATE` do histórico |
| Catálogo | `produtos` | global. Sem `bar_id` |
| Estoque lacrado do bar | `estoque_movimentos` | saldo operacional. `produtos.estoque_atual` continua legado global |
| Identidade | `perfis` | único usuário. `bar_employees` só guarda título e status |

O que cada bar controla fora de `produtos`: preço de balcão em `bar_pricing`, preço JBM em `bar_product_prices`, drink em `drink_menu`, estoque no livro, mínimo em `replenishment_rules`, favorito e IA e taxa em `pos_bar_config`.

Piso: `bar_spaces`, `pos_tickets`, `pos_ticket_items`. O ticket guarda `open`, `closed` ou `void`. Disponível, ocupado e aguardando pagamento são leitura da tela, não quatro status gravados. `pos_idempotency` e `pos_sale_events` impedem a segunda venda da mesma chave. `pos_close_with_charges` não aplica taxa de novo quando a chave já fechou.

CRM: `bar_guests` e `bar_visits`, com `bar_id`. A visita aponta para o espaço, o convidado e, quando existe, `pos_vendas`. O papel `cliente` continua sendo o login do dono do bar, não o convidado.

Ponto: uma linha por batida (`tipo` `in` ou `out`, `punched_at`). O trigger `time_clock_guard` recusa segunda entrada, saída sem entrada e sobreposição. Intervalo (`break`) não é coluna: a API não grava isso. A noite operacional continua `pos_tokyo_night` (Ásia/Tóquio, antes das 06:00 pertence à noite anterior).

Folha: `payroll_rules`, `payroll_periods`, `payroll_lines`, `payroll_audit`. Tipos já existentes: `base_salary`, `regular_hours`, `overtime`, `night_premium`, `commission`, `bonus`, `reward`, `advance`, `deduction`, `adjustment`. Bruto e líquido são a soma das linhas. Transporte não entra: não há escritor.

Compras: `sql/supplier_fulfillment.sql` e, depois, `sql/procurement.sql`, para a função mais nova prevalecer. Fluxo: pedido do bar, plano, fonte, tarefa, compra, recebimento, depósito, embarque, confirmação do bar, estoque. `deduct_stock` e `create_order` ficam de fora.

RLS liga nas tabelas novas e em `caixa_movimentos`. Não liga em `vendas`, `pedidos`, `perfis` nem `produtos`. Policy não usa `USING (true)`. Função `SECURITY DEFINER` declara `search_path`.

`scripts/buildMigrationFinal.mjs` regenera o arquivo a partir dos scripts fonte. Editar só o SQL fonte sem rodar o builder deixa `sql/migration_final.sql` defasado. O validador estático é `scripts/validateMigration.mjs`.
