#!/bin/bash
set -e

# ============================================
# ATOMIC BAR POS — Deploy Script
# Usage: bash deploy.sh
# ============================================

GITHUB_USER="umeokayudi"
GITHUB_TOKEN="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"
REPO_NAME="-atomic-bar-pos"
SUPABASE_URL="https://ojirgkqtqvugqktyuhem.supabase.co"
BAR_ID="b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9"

echo ""
echo "╔══════════════════════════════════╗"
echo "║     ATOMIC BAR POS — DEPLOY      ║"
echo "╚══════════════════════════════════╝"
echo ""

# 1. Supabase anon key
echo "Cole o SUPABASE_ANON_KEY do projeto Bebidas Control:"
read -r ANON_KEY
if [ -z "$ANON_KEY" ]; then
  echo "❌ Anon key não pode ser vazio."
  exit 1
fi

# 2. Destino
DEST="$HOME/Documents/atomic-bar-pos"

echo ""
echo "📁 Copiando projeto para $DEST ..."
cp -r "$(dirname "$0")" "$DEST" 2>/dev/null || true

cd "$DEST"

# 3. Write .env.local
python3 -c "
content = '''VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$ANON_KEY
VITE_BAR_ID=$BAR_ID
'''
open('.env.local', 'w').write(content)
"
echo "✅ .env.local criado"

# 4. Install deps
echo ""
echo "📦 Instalando dependências..."
npm install --silent

# 5. Build
echo ""
echo "🔨 Build..."
npm run build

# 6. GitHub — create repo if needed
echo ""
echo "🐙 Configurando GitHub..."
REPO_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$GITHUB_USER/$REPO_NAME")

if [ "$REPO_EXISTS" != "200" ]; then
  echo "   Criando repositório $REPO_NAME..."
  curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$REPO_NAME\",\"private\":true}" \
    "https://api.github.com/user/repos" > /dev/null
  echo "   ✅ Repositório criado"
fi

# 7. Git push
git init -q
git add .
git commit -q -m "deploy atomic-bar-pos $(date '+%Y-%m-%d %H:%M')" 2>/dev/null || \
  git commit -q --allow-empty -m "redeploy $(date '+%Y-%m-%d %H:%M')"

git remote remove origin 2>/dev/null || true
git remote add origin "https://$GITHUB_USER:$GITHUB_TOKEN@github.com/$GITHUB_USER/$REPO_NAME.git"
git branch -M main
git push -u origin main --force -q
echo "✅ GitHub ok"

# 8. Vercel deploy
echo ""
echo "🚀 Deploy Vercel..."
npx vercel --prod --yes \
  -e VITE_SUPABASE_URL="$SUPABASE_URL" \
  -e VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
  -e VITE_BAR_ID="$BAR_ID" 2>&1 | tail -5

echo ""
echo "╔══════════════════════════════════╗"
echo "║         ✅ DEPLOY COMPLETO       ║"
echo "╚══════════════════════════════════╝"
echo ""
echo "⚠️  Lembre de rodar o migration.sql no Supabase SQL Editor!"
echo ""
