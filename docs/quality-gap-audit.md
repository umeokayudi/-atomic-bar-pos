# Auditoria de qualidade

Leitura do código, do SQL do repositório e da auditoria read-only de produção já registrada em `docs/database-architecture-resolution.md`. Nesta passagem não houve deploy, nem SQL em produção, nem apagamento de dados.

A nota não sobe só porque o caminho feliz existe no código. Módulo que depende de tabela ou RPC ausente em produção fica abaixo de 4.

| Módulo | Antes | Agora | Por quê ainda não é 4, se for o caso |
|---|---|---|---|
| POS | 4/5 | 4/5 | O fechamento transacional está em `pos_close_ticket`. Produção não tem `pos_vendas` nem essa RPC. O caixa não opera lá até a migration. |
| POS UX | 2/5 | 3/5 | Busca única, favoritos, cards, confirmação, scanner que adiciona código exato e bloqueio de produto sem preço. Falta estoque real no card, split e mesa opcional. O piso ainda exige `space_id`. |
| Procurement | 5/5 | 5/5 | Fluxo bar → fonte → compra → depósito → embarque permanece. Testes de isolamento seguem passando. Não foi reescrito. |
| Supplier | 4/5 | 4/5 | O portal e o SQL escondem custo e margem. A tela simples de tarefas já existe. Produção não tem as tabelas de fulfillment. |
| Multi-tenant | 4/5 | 4/5 | Produto é global. Preço, estoque e configuração do caixa são por bar no desenho. `caixa_movimentos.bar_id` não existe em produção. |
| Inventory | 4/5 | 4/5 | O livro é `estoque_movimentos`. O código deixou de baixar também `produtos.estoque_atual` ao abrir garrafa. Mínimo, máximo, em trânsito e reservado não estão numa tela só. |
| Finance | 4/5 | 4/5 | `vendas` é conta JBM. `pos_vendas` é caixa do bar. Os dois livros continuam separados. Relatório acionável do dia ainda mistura leitura de tabelas que produção não confirma. |
| Payroll | 3/5 | 3/5 | `payroll_*` está no SQL. `time_clock` não está em produção. Hora real fica vazia até o ponto existir. |
| CRM | 3/5 | 3/5 | `bar_guests` e `bar_visits` são usados pela tela e não têm `CREATE` no repositório. Produção não as expõe. |
| Floor | 3/5 | 3/5 | Mesa, comanda e fecho existem no SQL do piso. Não há transferir mesa, mover item nem dividir conta. Produção não tem `bar_spaces`. |
| AI | 2/5 | 3/5 | Recomendação é card com motivo, por bar, sem chat. Não há histórico de venda ligado, então não afirma "vende muito" sem dado. Não explica o relatório do dia. |
| Security | 2/5 | 3/5 | O SQL novo tem `search_path`, RLS e papel. A chave HMAC padrão `atomic-lane` foi removida. As policies de produção não foram lidas nesta passagem e várias funções ainda não estão instaladas. |
| Architecture | 4/5 | 4/5 | A decisão produto global + fato por bar está fechada. A migration única ainda não foi escrita. |

## P0 — Segurança e integridade

| Módulo | Estado | Problema | Risco | Solução | Arquivos |
|---|---|---|---|---|---|
| Lane HMAC | Código | Assinatura caía para a string `atomic-lane` sem segredo | Qualquer um forja sessão de pista | Sem segredo, assinar e verificar devolvem nulo. O login responde 503 | `api/_hash.js`, `api/_barLaneAuth.js` |
| Estoque global | Código | Abrir garrafa gravava o movimento e ainda decrementava `produtos.estoque_atual` | Estoque de todos os bares muda junto | Só o movimento, com `bar_id`, permanece | `src/components/Estoque.jsx` |
| RLS de produção | Desconhecido | A auditoria anterior não leu policies | Bar A pode ver Bar B se a policy não existir | Não declarar seguro. A migration planejada liga RLS antes de abrir o caixa novo | `sql/*.sql` |
| `create_order` / `deduct_stock` | SQL do repo | Filtram `produtos.bar_id` e gravam balcão em `vendas` | Instalação quebra ou mistura livros | Não instalar. Decisão em `docs/database-architecture-resolution.md` | `sql/pos_sale_security.sql` |
| Service role | API | Fica no servidor, para convite e admin | Chave no browser seria acesso total | `src/lib/supabase.js` não contém `service_role` | `api/_supabaseAdmin.js` |

## P1 — POS

O caixa fixo e o celular usam `PosFloor` e `src/lib/posEngine.js`. Não há segundo POS.

O que o operador já consegue no código: buscar nome e código na mesma caixa, tocar favorito, ver card com preço ou "indisponível", confirmar o total, impedir segundo toque, recusar produto inativo ou sem preço, recusar item em comanda cujo status não é `open`. Código de barras com um único match adiciona o produto.

O que impede 4/5 na UX: a venda normal ainda pede mesa porque `pos_load_ticket` exige espaço; split, desconto e bottle keep ficam no modo detalhado ou no caixa antigo; o card não mostra saldo lacrado.

## P2 — Banco

Produção, pelo audit read-only anterior, não é o SQL do repositório. A matriz está em `docs/database-compatibility-matrix.md`. Nenhuma migration foi aplicada aqui.

## P3 — Floor

Estados reais da comanda no SQL: `open` e `closed`. A tela não mostra AVAILABLE / OCCUPIED / WAITING_PAYMENT como máquina de estados, e não transfere mesa nem divide conta. Inventar esses fluxos sem tabela de transferência criaria outro sistema de mesa.

## P4 — Procurement e supplier

Coberto pelos testes existentes. Supplier não recebe custo JBM nas funções já testadas. Embarque entre bares é recusado no teste. Não reescrever.

## P5 — Payroll e ponto

Um funcionário é `perfis`. `bar_employees` guarda título e status. `time_clock.staff_id` aponta para `perfis.id`. O ponto impede segundo clock-in e clock-out sem entrada em `api/_routeTimeClock.js`. A tabela não está em produção. Folha sem ponto não inventa hora.

## P6 — CRM

Convidado da casa é `bar_guests`, não o papel `cliente`. Visita é `bar_visits`. Sem essas tabelas em produção a ficha não abre.

## P7 — AI

Estratégia e pesos por bar em `pos_bar_config`. Sem a tabela, a recomendação fica desligada. Não há chatbot.

## P8

Não foi o foco. Build e testes cobrem o que mudou. Bundle do caixa continua grande. Não houve medição de render.

## Código morto e duplicado

`atomic-bar-pos/src/pages/POS.jsx` filtra `produtos.bar_id`. Não é o caixa atual. O caixa atual é `src/components/PosFloor.jsx`. O caixa antigo dentro de `AtomicPos` (`classicTill`) grava `pos_vendas` direto e não fecha a comanda do piso. Os dois livros de intenção são os mesmos (`pos_vendas`), mas são dois escritores. Unir os escritores é a migration do fechamento, não uma terceira tela.
