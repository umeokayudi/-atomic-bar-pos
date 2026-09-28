# POS — experiência do caixa

O caixa fixo (tablet) e o caixa de celular usam a mesma comanda. Só a tela muda. Este arquivo descreve o que já existia, o que passou a ser compartilhado, e o que o banco precisa ganhar antes de serviço, imposto e acréscimo de cartão serem gravados. Nada disto foi aplicado em produção.

## O que já existia

- A tela do bar abre `AtomicPos`. O caixa do dia é `PosFloor`.
- `PosMobile` e `PosTablet` já eram duas telas do mesmo estado. O modo fica em `POS_DEVICE_MODE`.
- A comanda é `pos_tickets` / `pos_ticket_items`, por `bar_id` e `space_id`.
- Incluir item: `pos_ticket_item`. Fechar: `pos_close_ticket`, com chave de idempotência.
- O preço do drink é `drink_menu.preco_venda`. O preço da dose é `bar_pricing.preco_drink`. Não há segundo catálogo.
- A venda do caixa continua em `pos_vendas`. A conta da JBM continua em `vendas`.
- A taxa de 3,78% em cartão já é custo do bar (`card_fee`, saída de caixa `taxa_cartao`). Não é o preço que o cliente paga a mais.
- `pos_settings` é lido pelo caixa antigo (serviço de mesa, mínimo de sala). Não tem `CREATE` neste repositório e não guarda favoritos nem IA.

## Caixa fixo

Tablet, `PosTablet`.

Busca no topo. Favoritos do bar em uma linha. Categorias do cardápio daquele bar. Grade de cards. Pedido aberto na coluna da direita, com quantidade, desfazer e total. Dinheiro, cartão, crédito e outros ficam no pedido. O botão abre a confirmação com o valor final. Garrafa, comissão e perda ficam atrás de "More details".

Um toque num favorito soma uma unidade na comanda aberta. Não abre modal.

A mesa continua sendo `bar_spaces`. Sem mesa escolhida, o produto não entra: `pos_load_ticket` exige `space_id`.

## Caixa de celular

`PosMobile`. Não é o tablet encolhido.

Busca, favoritos, categorias e recomendações na mesma rolagem. O carrinho fica fixo embaixo, com a quantidade e o total. As mesas continuam no passo Tables e também numa faixa quando ainda não há mesa. Scanner abre a câmera quando o aparelho tem `BarcodeDetector`. Sem câmera, o código é digitado na mesma busca.

## Busca

Uma caixa. O texto é comparado, ao mesmo tempo, com nome, nome japonês, nome inglês, SKU, código interno e código de barras, no cardápio já carregado do bar. Não há uma segunda ida ao banco por tecla.

`HEE` encontra Heineken. `BEER-001` encontra o código. O card mostra nome, código quando existe, e preço.

## IA

Não é chat. São até quatro cards, um toque cada.

Só entram produtos ativos, com preço maior que zero, deste bar. A estratégia e os pesos ficam em `pos_bar_config` daquele bar. Os pesos são normalizados. Produto destacado pelo gerente ganha o motivo "Featured by your manager." Sem histórico de venda, o caixa não diz que algo é campeão de vendas.

O "Why?" mostra uma frase curta.

## Quem configura

Cliente e gerente do próprio bar, e admin ou jbm da plataforma. Caixa e bar_staff não veem o botão e a policy de escrita não os aceita.

A tela é POS settings, aberta no caixa por quem tem `access === 'owner'`.

Cada linha é um `bar_id`. Bar A não lê a linha do Bar B: a policy exige `perfis.bar_id` igual, ou papel admin/jbm.

Favoritos, pesos, produtos em destaque, serviço, imposto e acréscimo de cartão moram nessa linha. Não há configuração global no navegador.

## Serviço, imposto e cartão

Desligados até o gerente ligar. Serviço zero não é o padrão de 10% do caixa antigo.

- Serviço: porcentagem ou valor fixo, sobre o subtotal dos drinks. Pode valer para salão, takeaway ou delivery. O piso de hoje é salão (`dine-in`).
- Imposto: porcentagem sobre o subtotal dos drinks. Não entra no serviço e não entra no acréscimo.
- Acréscimo de cartão: uma vez, sobre subtotal + serviço + imposto. Crédito usa a taxa de crédito. O botão Card usa a taxa de cartão. Other usa a outra. Dinheiro não leva acréscimo.

Exemplo com subtotal ¥10.000, serviço 10% e crédito 3%:

- serviço ¥1.000
- acréscimo ¥330
- total ¥11.330

O botão mostra esse total. O segundo toque não fecha de novo: a chave de `pos_close_ticket` e um trinco na tela bloqueiam o duplo clique.

Enquanto `sql/pos_ux.sql` não estiver instalado, serviço, imposto e acréscimo ficam em zero e o fechamento continua `pos_close_ticket`. Se o gerente ligar uma taxa e a função nova não existir, a venda não fecha pela metade: a tela avisa e para.

Quando a função existe, `pos_close_with_charges` chama `pos_close_ticket` na mesma transação, grava o total do cliente em `pos_vendas.total`, deixa o subtotal dos drinks, anota `Charge: service=… tax=… surcharge=…` e ajusta a entrada de caixa daquela venda. Uma segunda chamada com a mesma chave volta como duplicada e não soma de novo. A taxa de 3,78% do processador continua separada.

Isto não substitui a contabilidade nem o imposto da JBM.

## Tabelas e funções

Reutilizadas: `drink_menu`, `bar_pricing`, `produtos`, `bar_spaces`, `pos_tickets`, `pos_ticket_items`, `pos_vendas`, `pos_vendas_itens`, `caixa_movimentos`, `pos_close_ticket`, `pos_ticket_item`, `pos_load_ticket`, `pos_preview_ticket`.

Nova, só se o script for aplicado: `pos_bar_config`.

| | |
|---|---|
| TABLE | `pos_bar_config` |
| PURPOSE | favoritos, IA, serviço, imposto e acréscimo daquele bar |
| BAR SCOPING | `bar_id` chave primária, referência a `bars` |
| RLS | ligada |
| WHO CAN READ | login do mesmo bar (`cliente`, `gerente`, `caixa`, `bar_staff`) ou `admin` / `jbm` |
| WHO CAN WRITE | `cliente` e `gerente` do mesmo bar, ou `admin` / `jbm` |

Funções novas: `pos_quote_charges` e `pos_close_with_charges`. As duas exigem `pos_require_bar`. Não há tabela nova de produto, pedido, venda ou usuário.

O script está em `sql/pos_ux.sql`. Não foi executado em `ojirgkqtqvugqktyuhem` nem em `fxsakrshmldmkdmbevna`.

## O que a tela ainda não faz

- Não grava busca, recomendação aceita ou tempo de venda. O evento fica só numa lista em memória (`posEvent`) para um analytics futuro.
- Takeaway e delivery existem na configuração. O piso atual só fecha salão.
- Split de pagamento continua no caixa antigo, dentro de "More details" não foi refeito.
- O scanner depende de `BarcodeDetector` no aparelho.
