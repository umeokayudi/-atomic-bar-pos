# Isolamento dos livros antigos

Esta nota descreve o que o código faz. Ela não descreve o estado do Supabase ao vivo. Nenhum SQL desta etapa foi aplicado no banco.

`sql/procurement.sql` não foi alterado.

## Papéis no shell

| Papel | Telas do shell | Livro da empresa | Livro do bar |
| --- | --- | --- | --- |
| admin | painel completo, inclusive Procurement | lê e grava | todos os bares |
| jbm | Procurement e fulfillment | não | não abre vendas, faturas, compras, ryoshusho |
| funcionario | só Procurement | não | não |
| staff | compras, vendas, relatório, ryoshusho, produtos | não consulta | só `perfis.bar_id`; sem bar, a query não sai |
| fornecedor | portal do fornecedor | não | não |
| cliente, gerente, caixa, bar_staff | portal do bar | não | o bar ligado à conta |

`jbm` é HQ no banco (`is_jbm()` e `is_procurement_hq()` = admin ou jbm) e agora também no shell. O shell de `jbm` não inclui o livro financeiro antigo. Isso é de propósito: HQ de operação não é o mesmo que admin do livro da empresa.

Staff não é HQ. A tela de compras da empresa continua no menu, mas não dispara `SELECT` nem `POST` sem `allowCompanyLedger`. Compras da empresa não têm `bar_id` na gravação da tela, então não dá para filtrá-las por bar sem inventar uma coluna.

## `user_can_access_bar`

A função em `sql/pos_sale_security.sql`, e as cópias em `migration.sql` e `atomic-bar-pos/migration.sql`, só trata como portal de bar os papéis `cliente`, `gerente`, `caixa` e `bar_staff`, além de `admin`.

`staff`, `funcionario`, `jbm` e `fornecedor` deixam de passar só porque `perfis.bar_id` está preenchido.

REQUER VALIDAÇÃO NO SUPABASE. O arquivo no repositório não altera o banco sozinho.

## RLS que existe no repositório

Policies de procurement e fulfillment estão em `sql/procurement.sql` e `sql/supplier_fulfillment.sql`. Policies de cast estão em `sql/pos_sale_security.sql`.

Não há `CREATE POLICY` neste repositório para:

- compras
- compras_itens
- vendas
- vendas_itens
- faturas
- ryoshusho
- produtos
- bars
- caixa_movimentos
- fornecedores
- perfis

REQUER VALIDAÇÃO NO SUPABASE. Um cliente autenticado que chame `supabase.from` direto ainda depende das policies que só existem no banco real. O shell e as APIs com service role desta etapa não são essa policy.

## APIs com service role fechadas para admin

`requireGlobalFinance` exige papel `admin` ou o segredo interno de cron. Passaram a usá-la:

- `api/compras.js`
- `api/dashboard.js`
- `api/billing-hub.js`
- `api/admin-user.js`
- `api/_routeCashflowExport.js`
- `api/_routeHoldingAudit.js`
- `api/_routeHoldingModules.js`
- o snapshot em `api/holding/[[...fn]].js`
- o módulo `seikyusho` em `api/chat.js`

O chat geral continua na checagem antiga. A reposição de POS exige o bar da conta quando quem chama não é admin.
