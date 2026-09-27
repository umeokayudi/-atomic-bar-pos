# POS do Atomic — fase 2

O caixa do bar continua em `pos_vendas` e `pos_vendas_itens`. O estoque lacrado continua em `estoque_movimentos`. A garrafa aberta continua em `pos_bottles`. O catálogo continua em `drink_menu`, `produtos` e `bar_pricing`. As mesas continuam em `bar_spaces`. A comissão continua a regra de `src/lib/drinkBackPay.js` (drink da pessoa, preço acima de ¥2.000, teto ¥2.000, percentual em `drink_back_agents`). Garrafa e linha com `produto_id` não geram drink back. O livro `vendas` da JBM não recebe venda de balcão.

`sql/pos_floor.sql` não foi aplicado no Supabase.

## Comanda

Uma mesa tem no máximo uma comanda `open` (`pos_tickets`). Outro aparelho autorizado carrega a mesma linha. O refresh lê o banco, não o estado do navegador. Itens entram e saem por `pos_ticket_item` enquanto a comanda está aberta. `added_by` é quem lançou o item. `created_by` é quem abriu. `closed_by` é quem cobrou. Não há tabela nova de funcionário: os três são `perfis.id` / `auth.uid()`.

Troca de funcionário não reescreve o item antigo. Dois toques criam dois itens. Remover duas vezes o mesmo item falha na segunda. Fechar duas vezes devolve a mesma venda. A chave de idempotência vale para o fechamento: a mesma chave repete a venda; uma falha antes de gravar permite tentar de novo; outra comanda com outra chave é outra venda.

Depois de `closed` não entra item. O pagamento só acontece em `pos_close_ticket`.

## Drink e garrafa

O banco escolhe o caminho. O navegador não escolhe.

- Linha de `drink_menu`: precisa de `pos_recipes` / `pos_recipe_lines`. Sem receita a venda não fecha. Mililitros saem da garrafa aberta, em FIFO. Uma linha da receita com `quantity` e sem ml baixa unidade só daquele produto (mixer). A mesma linha da receita não pode ter ml e unidade.
- Linha só com `produto_id`: baixa unidade lacrada. Não consome ml.

Uma dose não baixa uma garrafa lacrada e também ml. Abrir garrafa baixa 1 unidade e cria a garrafa com `produtos.volume_ml` e `produtos.custo` quando existe. O navegador não envia o volume. Volume tem de ser maior que zero e a garrafa nasce cheia, então o volume atual não passa do original. Duas aberturas da última unidade: o lock `pg_advisory_xact_lock` deixa uma passar e a outra recebe `bottle not in stock`.

`pos_bottle_board` devolve produto, volume original, volume atual, percentual, quem abriu, quando abriu, consumo e waste. Não há dashboard novo.

## Caixa e estorno

`pos_vendas.total` permanece o bruto. `refunded` acumula o estorno. `comissao_valor` permanece; `comissao_estornada` acumula a reversão proporcional. `card_fee` é a taxa cobrada uma vez (3,78% em card/credit; dinheiro e other não têm taxa). `card_fee_reversed` acumula a reversão. O caixa ganha uma saída `pos_void` e, se havia taxa, uma entrada `taxa_cartao_estorno`. Nada é apagado.

O fechamento da noite usa bruto, estornos, líquido e taxa. Não soma só `pos_vendas.total`.

Estorno parcial mexe só na quantidade daquele item e não aceita a mesma quantidade duas vezes. Devolve ml da garrafa ou unidade do estoque conforme o caminho da linha.

## O que permanece, o que fica de lado, o que sai depois

Permanece: `pos_close_ticket` como fechamento do piso; `create_order` como livro de conta da JBM (`vendas`), sem ser chamado pelo piso novo; Procurement (pedido, compra, recebimento, embarque, confirmação, entrada em `estoque_movimentos`).

Fica isolado, só para quem não é caixa: o botão Previous till (`commitPosSale` e a baixa fracionada de `posSupply`). Esse fluxo não fecha a comanda nova e não mistura o livro. O caixa comum não vê o botão.

Depreciado: carrinho só no navegador; volume de garrafa digitado na tela; venda de drink sem receita; dose que baixa unidade lacrada; estorno que apaga a venda (`rollbackPosSale`).

Ainda para remover, quando o piso novo cobrir serviço, VIP e desconto: `PosCheckoutTab`, `commitPosSale` e `deductBottlesForPosSale` no uso diário. Não foram apagados nesta fase.

## Procurement

O POS termina em `estoque_movimentos` e `pos_bottles`. Não há reposição automática nem alteração de Procurement.
