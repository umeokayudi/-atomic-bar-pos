# Evidência do schema de produção

Esta passagem não consultou `ojirgkqtqvugqktyuhem` nem o holding. Não houve SQL em produção e não houve deploy.

Três rótulos. Um item UNKNOWN não vira hipótese e não vira fato.

- **KNOWN** é o que está neste repositório, ou o que a auditoria read-only anterior registrou por escrito. O que veio daquela auditoria está marcado como tal e não foi relido agora.
- **UNKNOWN** é o que ninguém deste repositório provou.
- **INFERRED** é uma leitura possível. A migration não age com base nela.

## KNOWN

### Repositório

- Não existe `CREATE TABLE` para `perfis`, `produtos`, `vendas`, `pedidos`, `pedidos_itens`, `fornecedores`, `estoque_movimentos`, `caixa_movimentos` nem `bars`.
- Não existe `CREATE POLICY` para `vendas`, `pedidos`, `perfis` nem `produtos`. A migration não executa `ENABLE ROW LEVEL SECURITY` nessas quatro.
- `sql/migration_final.sql` não contém `deduct_stock`, `create_order`, `produtos.bar_id`, nem `UPDATE` de `caixa_movimentos.operational_day`.
- O piso em `src/components/PosFloor.jsx` fecha com `pos_close_ticket` ou `pos_close_with_charges`. Não chama `create_order` nem `deduct_stock`.
- `create_order` é chamado em `atomic-bar-pos/src/pages/POS.jsx`. Esse arquivo filtra `produtos.bar_id` e não é o piso atual.
- `commitPosSale` em `src/lib/atomicPos.js` grava `pos_vendas` direto. É o caixa clássico, não o fechamento do piso.
- Policies novas do repositório não usam `USING (true)`. Funções `SECURITY DEFINER` declaram `search_path`. O teste `scripts/securityModel.test.mjs` cobre isso.
- `scripts/fixtures/legacy_schema.sql` é um stand-in local. Passar nesse fixture não prova que produção tem as mesmas colunas, chaves ou policies.

### Auditoria read-only anterior, não repetida aqui

Registrada em `docs/database-architecture-resolution.md`. Aquela leitura não foi refeita nesta etapa. Ela não incluiu PK, FK, índice, trigger, grant nem policy.

- `produtos` visto sem `bar_id`, com `volume_ml` e contadores globais de estoque.
- `vendas` visto com `cast_id` e `comissao_total`, sem `forma_pagamento`, `mesa`, `status`, `origem`.
- `caixa_movimentos` visto com `id`, `tipo`, `valor`, `data`, `descricao`, sem `bar_id`, `referencia_tipo`, `referencia_id`, `operational_day`.
- `estoque_movimentos` visto com `bar_id`, `criado_por`, `obs`.
- `pedidos` visto sem `public_code` e sem `entrega_desejada`.
- `pos_vendas` não apareceu. `time_clock`, piso, fulfillment, procurement e `bar_employees` não apareceram.
- `bar_pricing`, `drink_menu` e `cast_members` não foram provados naquela leitura.

## UNKNOWN

- O texto real das policies de `vendas`, `pedidos`, `perfis` e `produtos`, inclusive se RLS está ligado.
- Se `caixa_movimentos` já tem RLS ou outra policy além da que este arquivo criaria.
- PK, FK, índices, checks e tipos exatos de todas as tabelas legadas.
- Se `bar_pricing` existe em produção e se algum par `(bar_id, produto_id)` está repetido.
- Se `pos_vendas` ou `drink_menu` existem com outra forma que o `CREATE TABLE IF NOT EXISTS` apenas pularia.
- Grants atuais de `anon` e `authenticated` nas tabelas legadas.
- Se `perfis` tem `FORCE ROW LEVEL SECURITY`.

Nenhum desses itens foi preenchido por semelhança com o fixture.

## INFERRED

Nada nesta lista é usado pela migration.

- O app da JBM lê `caixa_movimentos` sem `bar_id` em `src/components/Cashflow.jsx`. Isso mostra a intenção da tela. Não prova que as linhas de produção estão sem `bar_id`; isso vem só da auditoria anterior, que está em KNOWN como nota não relida.
- `Compras.jsx` tenta gravar `metodo` e ignora o erro. Não prova que a coluna existe ou que não existe.

## LEGACY UNASSIGNED CASH MOVEMENTS

Registros antigos de `caixa_movimentos` podem não ter `bar_id` nem `operational_day`. A migration adiciona as colunas anuláveis e não faz `UPDATE`.

Não há referência estável para um backfill. `referencia_id` não existe nessas linhas. `descricao` é texto livre. Associar um bar por descrição seria chute. Não é feito.

Depois da policy escrita neste repositório, se ela for a única policy e a RLS estiver ligada por este arquivo:

- HQ (`admin` ou `jbm`, via `is_procurement_hq`) continua vendo a linha sem bar.
- Usuário de bar não vê essa linha.
- Uma linha nova só é visível para o bar quando `bar_id` vem preenchido.

Se produção já tiver outra policy em `caixa_movimentos`, o efeito combinado é UNKNOWN. Por isso a RLS dessa tabela é SAFE WITH PRECHECK, não um fato de produção.

## Limitação do fixture

`scripts/fixtures/legacy_schema.sql` e `scripts/fixtures/legacy_seed.sql` existem para o teste local `npm run test:migration:pg`. Eles validam sintaxe, ordem, segunda execução e a parada de duplicata. Não são um dump. Compatibilidade com eles não é compatibilidade com produção.

## Verificação externa ainda obrigatória

BLOCKED / EXTERNAL VERIFICATION REQUIRED:

- Ler `pg_policy` e `relrowsecurity` de `vendas`, `pedidos`, `perfis` e `produtos` no banco real, sem alterar nada, antes de qualquer execução.
- Ler o mesmo para `caixa_movimentos`.
- Rodar `scripts/checkBarPricingDuplicates.mjs` num banco descartável copiado de produção, ou numa sessão somente leitura que um humano autorize. Este agente não apontou o script para Supabase. O script recusa host `supabase.co`.
