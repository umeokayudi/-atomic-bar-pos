# Preparação da primeira homologação

Este documento prepara uma instalação em um projeto Supabase novo e isolado. A homologação não foi executada. Nenhum SQL foi enviado a um banco hospedado. Os projetos `ojirgkqtqvugqktyuhem` e `fxsakrshmldmkdmbevna` não devem ser usados.

## Checklist de pré-requisitos

- Projeto Supabase novo, vazio, sem dados de bar e sem as duas referências protegidas.
- PostgreSQL compatível com o que o projeto Supabase oferecer. O conjunto local que passou foi PostgreSQL 16. O comportamento local não é prova do hospedado.
- Papel de instalação com direito de criar tabelas, funções, policies e grants no schema `public`.
- Auth do Supabase já presente: schema `auth`, função `auth.uid()`, roles `anon`, `authenticated` e `service_role`. O instalador cria esses objetos só quando eles não existem. Ele não grava senha e não insere `auth.users`.
- Nenhuma variável de produção alterada. A URL e a chave do projeto novo ficam só no ambiente de homologação, fora deste repositório.
- Cópia do repositório no commit que contém `sql/install_fresh.sql`. Não usar `sql/master_schema.sql` como entrada de banco vazio.
- Janela para interromper a instalação. Não há migration de volta.

## Ordem das migrations

Rodar `sql/install_fresh.sql` com parada no primeiro erro. A ordem interna é:

1. `sql/foundation/001_extensions_and_auth.sql`
2. `sql/foundation/002_identity_and_bars.sql`
3. `sql/foundation/003_operational_catalog.sql`
4. `migration.sql`
5. `sql/pos_sale_security.sql`
6. `sql/supplier_fulfillment.sql`
7. `sql/procurement.sql`
8. `sql/pos_floor.sql`
9. `sql/payroll.sql`
10. `sql/foundation/080_operations.sql`
11. `sql/foundation/090_security.sql`
12. `sql/foundation/095_review.sql`

Depois, somente leitura: `sql/verify_schema.sql`. A linha final precisa ser `SUMMARY` com status `OK`.

Repetir `sql/install_fresh.sql` no mesmo banco vazio é suportado. Não rodar `sql/supplier_fulfillment.sql` sozinho depois de `sql/procurement.sql`.

## Extensões

O instalador não exige `dblink`. A recusa de cancelamento não abre outra conexão e não embute senha.

`gen_random_uuid()` precisa existir. No PostgreSQL 13 ou mais novo ele faz parte do núcleo. Se o projeto Supabase ainda exigir a extensão `pgcrypto` para essa função, habilitar `pgcrypto` antes do passo 1 e parar se a função continuar ausente.

Não habilitar `dblink` para esta instalação.

## Permissões e roles

Roles de login do Supabase:

- `anon` — uso do schema, sem escrita operacional por este instalador.
- `authenticated` — usuário com JWT. Recebe `EXECUTE` nas funções de caixa, cancelamento, preço e indicador, e `SELECT` em `pos_void_audit`. Não recebe `INSERT`, `UPDATE` nem `DELETE` nessa auditoria.
- `service_role` — ignora RLS. Reservado ao servidor. Não usar no navegador.

Papéis de perfil em `perfis.role`: `admin`, `jbm`, `gerente`, `caixa`, `bar_staff`, `funcionario`, `fornecedor`, além de `cliente` e `staff` já citados nas policies.

`user_can_access_bar` aceita perfil do bar, membership viva, ou `admin` com `platform_access` de escopo `hq`. `jbm` sem essa linha de HQ não alcança todos os bares. `is_jbm`, `is_procurement_hq` e `is_payroll_hq` exigem `admin` ou `jbm` com a concessão HQ viva.

Cancelamento: o chamador precisa ser o aprovador e ser `gerente` daquele bar (perfil ou membership) ou `admin`/`jbm` com HQ viva. Caixa do bar não cancela.

## Testes de isolamento entre bares

Executar com dois usuários autenticados, cada um com `perfis.bar_id` de um bar diferente, e `SET ROLE authenticated` mais o `sub` do JWT. Superusuário ignora RLS; o teste tem de trocar o role.

- Bar B não lê `vendas` nem `pos_vendas` do bar A.
- Bar B não insere `pedidos` no bar A.
- Bar B não carrega ticket do bar A (`pos_load_ticket` responde `bar not allowed`).
- Fornecedor ligado a um supplier não lê `produtos` (custo oculto) e não lê o vínculo de outro supplier.
- Funcionário A não lê folha do funcionário B.
- Alerta de fulfillment do bar A não aparece para o fornecedor de outro supplier nem para o bar B.

## Testes de autenticação

- Sem `auth.uid()`, a função operacional responde `not authenticated` ou `void audit failed` e não grava venda.
- Caixa do bar fecha ticket e não cancela. O retorno de `pos_void_sale` é NULL. A venda permanece. Uma linha `pos_void_audit.result = denied` fica visível para esse usuário e invisível para o gerente do outro bar.
- Gerente do bar cancela. A linha `applied` nasce na mesma transação.
- `jbm` sem `platform_access` recebe NULL e `denied` ao tentar o bar. Com membership, abre o caixa daquele bar. Com HQ, a visita entra em `platform_access_audit`.
- `UPDATE` e `INSERT` direto em `pos_void_audit` falham com permissão negada.

## Testes de venda, pagamento, caixa, estoque, procurement e cancelamento

- Fechar um ticket à vista grava `pos_vendas` e uma entrada de caixa. Cartão grava a taxa em `caixa_movimentos` (`taxa_cartao`) e não uma venda em dinheiro zerada.
- Pagamento dividido soma o líquido antes de gravar. Segunda chamada com a mesma chave devolve a mesma venda.
- Fechar o caixa da noite com o valor esperado funciona uma vez. A segunda chamada responde `already closed`.
- Duas saídas de estoque concorrentes: uma confirma e a outra não deixa saldo negativo.
- Preço de procurement só em `bar_product_prices`. Sem linha, preço zero ou dois preços no mesmo patamar: a função recusa. Não usa `produtos.preco_venda`.
- `create_order` continua no preço de lista JBM do produto com `produtos.bar_id` daquele bar. Preço ausente ou não positivo recusa. Pedidos já gravados conservam `pedidos_itens.preco_unitario`.
- Cancelamento aceito é atômico: dinheiro, estoque e `applied` caem juntos se a transação desfaz.
- Cancelamento negado não altera `refunded` nem `void_status`.
- Dois cancelamentos parciais de um item de quantidade 2 esgotam a linha. O terceiro recusa (`already void` ou `refund exceeds`) e não cria outro `applied`.
- `sales_indicator('till', bar)` e `sales_indicator('jbm', bar)` devolvem bruto, estornos, líquido e contagens separados. `sales_indicator('both', bar)` recusa. Uma venda anulada permanece e entra com líquido 0. Um estorno parcial mantém o total original.

## Interrupção e recuperação

`sql/install_fresh.sql` usa `ON_ERROR_STOP`. Cada comando bem-sucedido fica gravado. O comando que falha desfaz só a própria transação. O arquivo inteiro não é uma transação única.

Se a instalação parar:

1. Guardar a mensagem SQL e o arquivo em que parou. Não continuar no arquivo seguinte.
2. Não apontar o aplicativo de produção para esse banco.
3. Se o banco ainda não tem venda, usuário real ou configuração de bar, `DROP DATABASE` (ou apagar o projeto Supabase vazio) é o retorno limpo.
4. Se já houver dado de homologação que precise ser mantido, não apagar. Corrigir o comando que falhou e repetir a partir do arquivo que parou só depois de ler o erro. Vários arquivos são idempotentes; isso não cobre um comando interrompido no meio de uma função.
5. Rodar `sql/verify_schema.sql` de novo. Sem `SUMMARY` / `OK`, a instalação não está pronta para o próximo teste.
6. Não há script que desfaça só `095_review.sql`.

## O que esta preparação não afirma

A homologação não foi concluída. O conjunto local em `docs/database/test-results.md` não substitui a execução neste projeto novo. Riscos que continuam abertos estão em `docs/database/review-decisions.md`.
