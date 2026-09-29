# Modelo de segurança

Isto descreve o que o código e o SQL do repositório fazem. Não descreve as policies que estão hoje em produção: elas não foram lidas nesta passagem.

## Identidade

Senha fica no Supabase Auth. O app não tem coluna de senha.

```
auth.users
  → perfis.id = auth.uid()
  → perfis.bar_id     um bar para login de bar; nulo para admin e jbm
  → perfis.role       permissão
  → bar_employees     título e status, quando o script existir
```

Papéis de permissão: `admin`, `jbm`, `cliente`, `gerente`, `caixa`, `bar_staff`, `fornecedor`, `funcionario`, `staff`.

Título de trabalho (`manager`, `cashier`, `bartender`, `hostess`, `staff`, `cleaner`) não substitui o papel. O mapa está em `src/lib/employeeAccess.js`.

Convite: o gerente informa e-mail e título. O Supabase manda o convite. O funcionário define a senha. Status: `invited` → `active` → `suspended` → `inactive`. Não se apaga o histórico.

Recuperação de senha: `resetPasswordForEmail` e `updateUser`. Não há senha temporária na tela.

## Quem vê o quê

Bar (`cliente`, `gerente`, `caixa`, `bar_staff` com `perfis.bar_id` igual): vendas, estoque, pedidos, entregas, funcionários e convidados daquele bar. Custo de produto e margem JBM não entram no caixa.

`caixa` e `bar_staff` não gravam `pos_bar_config`. A policy de escrita é `cliente` e `gerente` do mesmo bar, ou `admin` / `jbm`.

HQ (`admin`, `jbm`): operação da plataforma. `is_procurement_hq` é admin ou jbm. Não é um segundo login.

Supplier: tarefas, produto e quantidade atribuídos. O SQL de procurement e os testes recusam custo de compra, frete e margem na visão do supplier, e recusam a tarefa de outro supplier.

## RPC `SECURITY DEFINER`

As funções deste repositório declaram `search_path`. O teste `scripts/securityModel.test.mjs` falha se uma função `SECURITY DEFINER` nova esquecer isso, ou se aparecer `USING (true)`.

Toda função de caixa passa por `pos_require_bar`: usuário autenticado, `user_can_access_bar` ou papel `admin` / `jbm`.

`pos_close_ticket` exige chave de idempotência. A segunda chamada com a mesma chave não cria outra venda. `pos_close_with_charges` devolve essa duplicata sem somar taxa de novo.

`create_order` e `deduct_stock` não entram nesse modelo até deixarem de usar `produtos.bar_id` e de escrever balcão em `vendas`.

## O que não é autorização

Menu escondido, `VITE_BAR_ID` e filtro no browser não isolam tenant. O filtro `.eq('bar_id')` no cliente é defesa extra. A trava é RLS e a função.

`src/lib/supabase.js` usa a chave anônima. Service role fica nas funções de API no servidor.

Sessão de pista (`lane:`) só é assinada com `SUPABASE_SERVICE_ROLE_KEY` ou `INTERNAL_API_SECRET`. Sem um dos dois, o token não é emitido. A chave fixa antiga foi removida.

## Auditoria

`audit_logs` existe no SQL de fulfillment. Convite, suspensão e mudança de papel já gravam ação. Venda, estorno e movimento de garrafa gravam `pos_sale_events` quando o piso está instalado. Ajuste de estoque é uma linha em `estoque_movimentos` com `criado_por`. Não há um segundo sistema de auditoria.

## Limite

Enquanto as policies não forem confirmadas em produção, este documento não torna o ambiente seguro. Instalar o SQL sem a migration planejada pode falhar no meio e deixar funções apontando para tabelas que não existem.

`vendas`, `pedidos`, `perfis` e `produtos` não têm `CREATE POLICY` neste repositório. Escrever uma policy para elas agora seria adivinhação. Estado: BLOCKED / EXTERNAL VERIFICATION REQUIRED. A evidência está em `docs/production-schema-evidence.md`.
