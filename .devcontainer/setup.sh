#!/usr/bin/env bash
# Provisiona o ambiente de dev do Codespace: dependências, .env, banco migrado e
# populado. Roda uma vez, no postCreateCommand. Pode rodar de novo — mas o passo
# de seed faz TRUNCATE ... CASCADE: recria o banco do zero e DESCARTA qualquer
# dado inserido à mão. Só o provisionamento é idempotente, não os dados.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> npm install"
npm install

if [ ! -f apps/api/.env ]; then
  echo "==> gerando apps/api/.env"
  ENC_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  cat > apps/api/.env <<EOF
# Gerado por .devcontainer/setup.sh — ambiente de dev do Codespace. NAO commitar.
NODE_ENV=development
PORT=3001
DATABASE_URL="postgresql://app_user:app_user_pw@db:5432/gestao_comercial?schema=public"
DIRECT_DATABASE_URL="postgresql://postgres:postgres@db:5432/gestao_comercial?schema=public"
APP_USER_PASSWORD="app_user_pw"
ENCRYPTION_KEY="${ENC_KEY}"
BETTER_AUTH_SECRET="${AUTH_SECRET}"
BETTER_AUTH_URL="http://localhost:3001"
WEB_ORIGIN="http://localhost:3000"
SEED_OWNER1_EMAIL="lucas.regoto@gmail.com"
SEED_OWNER2_EMAIL="owner2@example.com"
SEED_OWNER_PASSWORD="GestaoDev2026!"
NUVEMSHOP_APP_ID=34160
EOF
fi

if [ ! -f apps/web/.env.local ]; then
  echo "==> gerando apps/web/.env.local"
  echo 'NEXT_PUBLIC_API_URL=http://localhost:3001' > apps/web/.env.local
fi

echo "==> prisma migrate deploy"
npm run db:deploy -w api

echo "==> provisiona a senha do role app_user"
npm run db:provision-role -w api

echo "==> seed (loja do casal)"
npm run db:seed -w api

cat <<'EOF'

=====================================================================
 Ambiente pronto.   Rode:  npm run dev
   web    -> http://localhost:3000
   api    -> http://localhost:3001/health
   login  -> lucas.regoto@gmail.com  /  GestaoDev2026!
 (abra pelo VS Code Desktop conectado ao Codespace: as portas viram
  localhost de verdade e o cookie de sessao funciona sem ajuste.)
=====================================================================
EOF
