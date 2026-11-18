# Como voltar atrás (rollback) — JBM Tech

Sem segredos neste arquivo.

## Código (Vercel)
1. Abra o projeto `jbm` no painel da Vercel, aba Deployments.
2. Ache o último deploy de produção que estava bom (em 2026-11-18: branch `claude/project-thread-9hrl0k`, commit `ba2e583`).
3. Menu "⋯" do deploy → **Promote to Production** (ou "Instant Rollback"). Leva segundos e não mexe no banco.

## Banco (SQL pendente desta missão)
Cada arquivo em `sql/` termina com um bloco `-- Rollback:` com os comandos exatos.
- `sql/rls_por_papel.sql`: não altera dados; o rollback recria as políticas antigas (não recomendado: reabre o banco).
- `sql/storage_privado.sql`: `UPDATE storage.buckets SET public = true ...` volta os arquivos a públicos.
- `sql/money_structure.sql`: só adiciona colunas e índices; não precisa de rollback.

Ordem de aplicação: 1) publicar o código, 2) `rls_por_papel.sql`, 3) `money_structure.sql`, 4) `storage_privado.sql`.
Depois de cada passo: entrar como dono do bar, como caixa e como admin e abrir Faturas, POS e Pedidos.

## Dados
Nada desta missão apaga ou altera dado. Antes de aplicar SQL, o Supabase guarda backup diário (Database → Backups).

## Testes
`npm test` roda toda a suíte (dinheiro, POS, papéis). O GitHub roda o mesmo a cada push (`.github/workflows/tests.yml`).
