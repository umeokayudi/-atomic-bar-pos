# POS do Atomic

O caixa do bar continua em `pos_vendas` e `pos_vendas_itens`. O estoque geral continua em `estoque_movimentos`. O catálogo continua em `drink_menu`, `produtos` e `bar_pricing`. As mesas continuam em `bar_spaces`. A comissão de drink back continua a regra de `src/lib/drinkBackPay.js` (teto ¥2.000). O livro `vendas` da JBM não recebe venda de balcão.

`sql/pos_floor.sql` acrescenta a garrafa individual, a receita, a comanda aberta e o fechamento numa função só. O arquivo não foi aplicado no Supabase.

Abrir garrafa tira 1 unidade lacrada do estoque e cria a garrafa com o volume inteiro. O consumo seguinte é em mililitros, na ordem da abertura. Acabar o volume marca `depleted`. Quebra, desperdício e cortesia geram movimento. Não se apaga venda: estorno grava `pos_sale_events` e devolve o volume quando o estorno é total.

A taxa de cartão é 3,78%, a mesma de `create_order`, numa única saída de `caixa_movimentos`. Dinheiro não gera taxa. O preço usado no fechamento é o do cardápio, não o do navegador.

O dia da venda usa Asia/Tokyo e vira o dia anterior antes das 06:00, como o fechamento noturno que já existe.
