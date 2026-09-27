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

## Dia operacional e caixa

`pos_vendas.data` é a noite do caixa: antes das 06:00 em Asia/Tokyo pertence à noite anterior. `caixa_movimentos.data` continua sendo o instante real (`now()`), e não é apagado. `caixa_movimentos.operational_day` repete essa noite no momento do lançamento. O fechamento lê os dois: bruto, estornos e líquido vêm das vendas; o movimento de caixa (`pos_venda`, `pos_void`, `taxa_cartao`, `taxa_cartao_estorno`) entra pela noite operacional. Um lançamento de outro livro, como `venda` da JBM, não entra nessa conta.

Um estorno feito noutra noite fica na noite do estorno. A linha de fechamento mostra o líquido das vendas e o líquido do caixa lado a lado. Se um estorno atravessa a noite, os dois números deixam de coincidir de propósito.

## Garrafa na tela

Waste, breakage, spill, complimentary e adjustment usam `pos_bottle_move`. O motivo é obrigatório. A função grava o usuário, o instante, o volume, o status e um evento em `pos_sale_events`. Não há tabela nova.

## Permissões

Nada foi alterado. A matriz abaixo é o que o código já faz.

| Papel | Abre o POS | Abre garrafa / vende / fecha / estorna / waste | Vê garrafas (SELECT) | Outro bar via RPC | Outro bar via SELECT |
| --- | --- | --- | --- | --- | --- |
| admin | não, pelo portal do bar | sim | sim | sim | sim |
| jbm | não, pelo portal do bar | sim | não | sim | não |
| gerente, caixa, bar_staff, cliente | sim, no próprio bar | sim, no próprio bar | sim, no próprio bar | não | não |
| fornecedor, funcionario, staff | não | não | não | não | não |

`cliente` aqui é o papel antigo do dono do bar, não um cliente da mesa. Quem passa em `pos_require_bar` pode chamar todas as RPCs do piso, inclusive estorno e waste. Não há uma permissão separada para estorno. jbm chama a RPC porque `pos_require_bar` aceita `admin` e `jbm`, mas a política de SELECT continua sendo `user_can_access_bar`, que não inclui jbm.

## O que o piso novo não chama

`PosFloor` não chama `commitPosSale`, `create_order`, `syncPosStockAndReorder` nem `deductBottlesForPosSale`. Esses nomes continuam em `AtomicPos` só no Previous till, escondido do caixa.

Depois de validar em produção, o que pode sair é o Previous till: `PosCheckoutTab`, `commitPosSale`, `rollbackPosSale` e `deductBottlesForPosSale` / `syncPosStockAndReorder` quando o uso diário não depender mais de serviço, VIP, desconto e keep pour. `create_order` fica: é o livro `vendas` da JBM, não o caixa do bar.

## Suíte de Postgres

`npm run test:pos:pg` não faz nada sem `POS_PG_TEST_URL`. Recusa host `supabase.co` e qualquer base cujo nome não termine em `_test`, a menos que `POS_PG_ALLOW=1`. Não aplicar este comando na base real.

## Checklist da primeira instalação

1. Confirmar que a base de teste não é a de produção.
2. Aplicar `sql/pos_sale_security.sql` se `user_can_access_bar` ainda deixar `staff` ou `funcionario` entrar só porque `perfis.bar_id` está preenchido.
3. Aplicar `sql/pos_floor.sql` inteiro. Ele acrescenta `operational_day` e preenche as linhas antigas de `caixa_movimentos` com `pos_tokyo_night(data)`.
4. Confirmar `produtos.volume_ml` nas garrafas que serão abertas.
5. Criar ao menos uma receita em `pos_recipes` / `pos_recipe_lines` para cada drink do cardápio antes de cobrar.
6. Abrir uma garrafa, lançar o drink em dois aparelhos, cobrar uma vez, estornar uma unidade e ler o fechamento da noite.
7. Rodar `POS_PG_TEST_URL=postgres://.../pos_test npm run test:pos:pg` numa base vazia cujo nome termine em `_test`.
