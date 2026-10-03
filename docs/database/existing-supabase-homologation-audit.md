# Auditoria de compatibilidade com os Supabase existentes

Data da análise: 2026-10-03. Base de código: `5d6ed73` e os arquivos desta branch. Nenhum SQL foi enviado a `ojirgkqtqvugqktyuhem` nem a `fxsakrshmldmkdmbevna`. O catálogo remoto não foi lido. O que está no repositório não é prova do schema que está em produção.

## 1. Estado atual encontrado

Os dois projetos estão tratados como produção no código.

- Drinks/Bar, ref `ojirgkqtqvugqktyuhem`, é o destino padrão de `api/_supabaseAdmin.js`, de `migration.sql` e do `.env.example`. O cliente de serviço exige que a service role, quando presente, pertença a esse ref.
- Holding, ref `fxsakrshmldmkdmbevna`, é o destino padrão de `api/_holdingData.js`, `api/_routeHoldingAudit.js` e `api/sync-cashflow-cron.js`. O código lê `jbm_financeiro` e `hr_placements`. A chave de serviço da Holding pode ser lida de um arquivo no storage privado do projeto Drinks (`system-private/holding_service_role_key.txt`) quando a variável não está definida e o ambiente não é Preview.
- `src/lib/supabaseTarget.js` recusa os dois refs em Preview. Produção continua autorizada a abrir o projeto Drinks. Isso não foi alterado.
- Não há terceiro projeto, nem schema `homolog`, nem flag de tenant de homologação. `ATOMIC_STAGING_AUTHORIZED` só classifica um projeto novo. Não aponta para os dois refs protegidos.
- Este ambiente de auditoria não tem `DATABASE_URL`, URL de Supabase nem CLI do Supabase. Variáveis da Vercel não foram lidas nem alteradas.

`api/_applyBarSql.js` ainda sabe montar uma conexão com o pooler do projeto Drinks e aplicar SQL empacotado quando `VERCEL_ENV` não é `preview`. Esse caminho não foi chamado.

## 2. Estruturas já existentes no código

O instalador de banco vazio é `sql/install_fresh.sql`. Ele não é uma migration incremental. A ordem é:

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

`sql/master_schema.sql` não é a entrada de banco vazio. `sql/verify_schema.sql` só lê e exige `SUMMARY|OK`.

O que o código já modela, sem afirmar que o remoto tenha o mesmo formato:

- Identidade: `bars`, `perfis`, `bar_memberships`, `platform_access`, `platform_access_audit`. O papel sozinho não é concessão de HQ. `is_jbm()`, `is_procurement_hq()` e `is_payroll_hq()` passam a exigir `admin` ou `jbm` com `platform_access.scope = hq` viva. O corpo final está em `090_security.sql` e substitui o corpo anterior de `procurement.sql`.
- Operação de bar: `produtos`, `bar_catalog`, `vendas`, `vendas_itens`, `pos_vendas`, `pos_vendas_itens`, `caixa_movimentos`, `estoque_movimentos`, `pedidos`, `pedidos_itens`, `faturas`, `time_clock`, espaços e convidados.
- POS e cancelamento: `pos_void_sale`, `pos_void_audit`, `sales_indicator`.
- Fulfillment e procurement: tarefas, compras, remessas, preços de bar, rastreio por audiência.
- Folha: tabelas e funções de `sql/payroll.sql`.
- Holding, em outro projeto: `jbm_financeiro` e `hr_placements`. Essas tabelas não são criadas pelo instalador do bar.

Contagem estática dos arquivos SQL deste repositório, incluindo `migration.sql`:

- 90 funções `CREATE OR REPLACE`.
- 83 funções `SECURITY DEFINER`. Nas cabeças lidas, todas declaram `search_path`.
- 79 `DROP POLICY`.

`001` cria `auth.users` só com `IF NOT EXISTS` e só cria `auth.uid()` se a função ainda não existe. Num Supabase real, Auth já possui os dois. O arquivo não insere usuários.

## 3. Riscos identificados

O catálogo remoto é desconhecido. Aplicar o instalador, ou qualquer arquivo que faça `CREATE OR REPLACE` e `DROP POLICY`, muda segurança mesmo quando `CREATE TABLE IF NOT EXISTS` não recria a tabela.

- `090_security.sql` substitui `user_can_access_bar` e `is_jbm`. Um `jbm` ou `admin` que hoje opera sem linha em `platform_access` deixa de ser HQ no instante em que esse corpo entra. Não há backfill nesse repositório, e criar esse backfill sem a lista real de operadores seria um chute.
- Policies são permissivas. O PostgreSQL soma policies `PERMISSIVE` com OU. O script remove só policies com os nomes que ele conhece. Uma policy antiga com outro nome continua valendo e pode anular o isolamento novo.
- `FORCE ROW LEVEL SECURITY` nas tabelas financeiras muda quem enxerga linhas assim que a policy nova passa a ser a única. O efeito depende das policies que já existem. Isso não foi medido no remoto.
- `produtos.bar_id` nulo continua visível para quem não é fornecedor. Catálogo global e dado de um bar não são o mesmo limite.
- Funções `SECURITY DEFINER` ignoram RLS e confiam na checagem interna. Uma função antiga, ainda instalada e não substituída, continua com o corpo antigo. Uma função substituída passa a ter o corpo deste repositório, que não foi comparado com o corpo de produção.
- `service_role` ignora RLS. Scripts de API, cron e o caminho de `applyBarPosSql` usam esse papel. Um bar fictício no mesmo projeto fica visível para esses scripts se eles não filtrarem `bar_id`.
- `migration.sql` declara, no comentário, o ref do projeto Drinks como destino. Várias colunas usam `ADD COLUMN IF NOT EXISTS`. Isso não prova que as colunas existentes tenham o mesmo tipo.
- Constraints são recriadas em `procurement_tasks` e `fulfillment_alerts`. Se as linhas atuais não couberem na regra nova, o `ALTER` falha no meio e o arquivo não desfaz o que já passou. `install_fresh.sql` usa `ON_ERROR_STOP`, mas cada comando já confirmado permanece.
- Não há migration de volta. O rollback de produção seria backup ou PITR do próprio Supabase, não um script deste repositório.
- A chave da Holding no storage do projeto Drinks junta os dois projetos. Usar a Holding como banco de teste do bar aumenta essa superfície. O arquivo da chave não foi baixado.
- Um `is_demo` em linha, em bar ou em usuário não isola `SECURITY DEFINER`, `service_role`, relatórios sem filtro, nem o Auth compartilhado.

## 4. Comparação das alternativas

### A. Homologação lógica no banco Drinks

Isolar por `bar_id`, papéis e RLS no mesmo `public` do projeto que já opera os bares.

Riscos: dados fictícios e financeiros reais ficam nas mesmas tabelas. Um filtro ausente, uma policy antiga, uma função antiga ou um cliente `service_role` mistura os dois. Usuários fictícios seriam usuários reais do Auth de produção. Indicadores que somam o projeto inteiro incluiriam a homologação.

Limitações: o RLS novo ainda não está provado no remoto. HQ com `platform_access` vê todos os bares de propósito. Fornecedor entra por `supplier_users`, não por `bar_id`. `produtos` globais atravessam bares.

Alterações necessárias: inventário real das policies e funções, backfill explícito de HQ, revisão de cada RPC, e um critério que impeça relatórios e crons de lerem o bar fictício. Isso é um projeto de mudança em produção, não um flag.

Autenticação: o mesmo projeto Auth. Um JWT de produção chama as mesmas funções.

RLS e RPCs: compatível só depois do diff. Hoje o repositório substituiria corpos e policies.

Frontend: o cliente já usa `public`. Um bar fictício apareceria para quem tivesse membership ou HQ.

Rollback: não há script. Desfazer exige restaurar o banco.

Validação manual: catálogo, lista de policies, corpos de `is_jbm` e `user_can_access_bar`, e um ensaio de leitura cruzada com JWT real. Sem isso, A fica reprovada.

### B. Schema separado no projeto Drinks

Um schema `homolog` ao lado de `public`.

Riscos: Auth, `auth.users` e `service_role` continuam únicos. PostgREST expõe schemas configurados no projeto. Se `homolog` for exposto, o mesmo JWT pode chamá-lo. Funções `SECURITY DEFINER` no schema novo ainda rodam como dono. FKs para `auth.users` ligam o usuário de produção ao dado fictício.

Limitações: o frontend não chama `.schema('homolog')`. Todas as queries e RPCs assumem `public`. Grants, policies e Realtime teriam de ser duplicados. Extensões e `auth.uid()` são do projeto, não do schema.

Alterações necessárias: exposição do schema na API, cliente separado, e uma cópia do SQL com outro `search_path`. Nenhum arquivo atual faz isso.

Autenticação: incompatível com isolamento de credencial. Compatível só com convenção de cliente.

RLS e RPCs: teriam de ser recriados no schema novo. O SQL atual grava em `public`.

Frontend: mudança em todo acesso ao Supabase. O build de produção não pode apontar para esse schema por engano.

Rollback: `DROP SCHEMA` só é aceitável se o schema não tiver dado que alguém queira e se nenhuma função de `public` depender dele. Isso não está desenhado.

Validação manual: configuração do PostgREST e prova de que o cliente de produção não recebe o schema. Sem essa prova, B não isola.

### C. Homologação só em PostgreSQL local

O banco descartável `atomic_bar_foundation_test` recebe `sql/install_fresh.sql`. Produção não é conectada.

Riscos: o PostgreSQL local não reproduz Auth hospedado, pooler, PostgREST, storage, cron nem o corpo antigo das funções de produção. Um teste local que passa não libera deploy.

Limitações: não responde se o projeto Drinks já tem as tabelas novas, nem se as policies atuais são mais abertas.

Alterações necessárias: nenhuma em produção. O fluxo local já existe em `scripts/foundation.pg.test.mjs`.

Autenticação: o teste simula `auth.uid()` com `request.jwt.claim.sub` e `SET ROLE authenticated`. Não cria usuário no Auth da Supabase.

RLS e RPCs: exercitados nesse banco local, inclusive isolamento entre bares, fornecedor, funcionário, cancelamento e preço ausente.

Frontend: o demo do navegador continua desconectado. Preview sem projeto novo permanece em demo.

Rollback: `DROP DATABASE` do banco local. Produção não muda.

Validação manual: quando alguém for ao remoto, o preflight só de leitura desta pasta, numa sessão humana, com o ref confirmado. Até lá, C é o único caminho que preserva produção.

### D. Usar o projeto Holding

Instalar o domínio do bar em `fxsakrshmldmkdmbevna`.

Riscos: o código trata esse projeto como operação da Holding. Ele lê e grava módulos financeiros e de RH. O cron de caixa e a auditoria da Holding usam esse cliente. Não há evidência de que o banco esteja vazio. Nome repetido (`vendas`, `perfis`, `bars`) quebraria a operação existente ou, se as tabelas forem novas, colocaria o POS ao lado de `jbm_financeiro` sob o mesmo Auth e a mesma service role.

Limitações: o instalador do bar não cria o modelo da Holding, e o app da Holding não fala o modelo do bar. São dois produtos no mesmo projeto se alguém instalar os dois.

Alterações necessárias: um diff do catálogo da Holding, que esta auditoria não fez e não deve fazer por SQL a partir daqui.

Autenticação: usuários reais da Holding. Um login de teste seria um usuário desse projeto.

RLS e RPCs: desconhecidos. O app usa service role para ler `jbm_financeiro` e `hr_placements`.

Frontend: o bundle da Holding em `public/holding` não é o POS. Apontar o Atomic Bar para esse ref mistura os dois produtos.

Rollback: o mesmo problema de A, com o agravante de atingir financeiro e RH da Holding.

Validação manual: inventário completo desse projeto e confirmação de que nenhuma tabela, função ou cron seria tocado. Essa confirmação não existe. D fica reprovada.

## 5. Estratégia recomendada

Continuar a evolução do Atomic Bar em PostgreSQL local e no demo do navegador. Não escolher A, B ou D como implementação.

Não há decisão automática de produção. A recomendação é negativa para os dois projetos existentes: nenhum deles deve receber `install_fresh.sql`, o módulo SQL ou dados fictícios nesta fase.

Um caminho futuro, ainda não autorizado, teria esta ordem e pararia no primeiro item sem prova:

1. Backup ou janela de PITR confirmada por uma pessoa.
2. Rodar só `sql/audit/NOT_EXECUTED_readonly_catalog_preflight.sql`, por um humano, no projeto cujo ref foi lido em voz alta e não é um dos dois protegidos. Se o alvo for um dos dois, a sessão precisa ser só leitura e o resultado guardado fora do repositório. Este agente não faz essa sessão.
3. Comparar policies, corpos de `is_jbm` e `user_can_access_bar`, e tipos de colunas com este repositório.
4. Só então desenhar uma migration aditiva, com backfill de `platform_access` antes de substituir funções. Essa migration não está neste branch.

## 6. Arquivos preparados

Nenhum deles foi executado em Supabase remoto.

- `sql/audit/NOT_EXECUTED_readonly_catalog_preflight.sql` — só `SELECT`. Descreve presença de tabelas e funções, versão, quantidade de policies e se `is_jbm` já menciona `platform_access`.
- `sql/audit/NOT_EXECUTED_incremental_apply.sql` — não contém DDL. O único efeito possível é um `RAISE EXCEPTION`. A migration incremental foi interrompida porque substituir funções e policies sem o catálogo remoto não é seguro.
- `scripts/existingCatalogAudit.test.mjs` — confere que o preflight não tem verbo de escrita e que a recusa não altera `schema_install` no banco local.

## 7. Testes executados

Somente PostgreSQL local e análise estática. Nenhum host `supabase.co`.

| Comando | Resultado |
|---|---|
| `npm run test:foundation` | Banco local descartável. Instalação, segunda instalação e `verify_schema.sql` com `SUMMARY\|OK`. Isolamento de bar, fornecedor, funcionário, cancelamento, estoque e indicadores no banco local. |
| `node scripts/existingCatalogAudit.test.mjs` | O preflight local lista `platform_access` presente e `mutation = not_allowed`. A contagem de `schema_install` não muda. O arquivo incremental recusa e também não muda essa contagem. |
| `npm run test:supabase` | O classificador recusa os dois refs protegidos em Preview. |
| `npm run test:readiness` | Checklist local. Sem writer de staging. |

O demo do navegador não foi apontado para um banco.

## 8. Testes pendentes

Tudo isto exige o catálogo remoto e continua pendente:

- Diff de tabelas, colunas, policies, grants e corpos de função nos dois projetos.
- Leitura cruzada com JWT de dois bares reais.
- Persistência de `pos_void_audit.result = denied` num RPC hospedado.
- Comportamento do PostgREST, do Auth e do pooler diante de `FORCE RLS`.
- Efeito de `service_role` e dos crons sobre um bar fictício.
- Confirmação de que a Holding não tem tabelas com os nomes do POS.
- Qualquer ensaio de venda, caixa, estoque ou procurement em dados reais.

## 9. Procedimento manual

1. Não criar usuários fictícios nos dois projetos.
2. Não colar `install_fresh.sql` no SQL Editor de nenhum deles.
3. Não mudar variáveis de Production na Vercel e não fazer deploy.
4. Se a decisão de negócio for inspecionar o catálogo, uma pessoa com papel de leitura exporta o resultado do preflight e o guarda fora do git. O ref precisa ser conferido antes. Este repositório não recebe a saída se ela contiver dado de cliente.
5. Enquanto não existir um projeto vazio que não seja estes dois, a homologação hospedada permanece fechada. O desenvolvimento segue no PostgreSQL local.

## 10. Confirmação

Nenhum Supabase remoto foi alterado. Nenhum SQL remoto foi executado. Nenhuma variável da Vercel foi modificada. Não houve deploy nem merge. Nenhuma service role, senha ou token é copiada neste relatório.

Os testes locais não tornam o sistema pronto para produção.
