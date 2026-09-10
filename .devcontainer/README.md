# Ambiente de desenvolvimento em Codespace

Para quando o Postgres local não é uma opção (rede corporativa bloqueia o
protocolo do Postgres). Node 22 + Postgres 16 rodam **dentro** do Codespace;
nada de banco sai pela rede.

## Abra pelo VS Code Desktop — não pelo navegador

O editor web do Codespaces (`github.dev`) publica cada porta num subdomínio
diferente (`<nome>-3000.app.github.dev`, `<nome>-3001.app.github.dev`). Esses
subdomínios são **cross-site** (o `app.github.dev` está na Public Suffix List), e
o cookie de sessão em modo dev é `SameSite=Lax` — ou seja, o navegador **não
manda o cookie** do front para a API. Login parece funcionar mas o painel dá 401,
sem mensagem clara.

Pelo **VS Code Desktop** conectado ao Codespace, as portas viram `localhost:3000`
e `localhost:3001` de verdade na sua máquina — mesma origem lógica do dev local,
cookie funciona sem ajuste.

### Como conectar

1. Instale a extensão **GitHub Codespaces** no VS Code Desktop.
2. `Ctrl+Shift+P` → **Codespaces: Create New Codespace** → escolha
   `Noletu/gestao-comercial-web` e a branch.
   - Já criou pelo site? `Ctrl+Shift+P` → **Codespaces: Open in VS Code Desktop**.
3. Aguarde o build + `setup.sh` (~2–4 min na primeira vez).
4. No terminal do Codespace: `npm run dev`.
   - web → http://localhost:3000
   - api → http://localhost:3001/health
   - login → `lucas.regoto@gmail.com` / `GestaoDev2026!`

## O que o `setup.sh` faz

`npm install` → gera `apps/api/.env` e `apps/web/.env.local` (segredos aleatórios,
banco apontando pro serviço `db`) → `prisma migrate deploy` → `db:provision-role`
(senha do `app_user`) → `db:seed` (loja do casal). Mesma ordem do `start:prod` do
[`DEPLOY.md`](../DEPLOY.md).

Re-rodar o `setup.sh` **recria o banco do zero** (o seed faz `TRUNCATE`).

## Fora do Codespace

Este diretório é inerte. O dev local no host segue com
[`scripts/dev-db.ps1`](../scripts/dev-db.ps1) ou o
[`docker-compose.yml`](../docker-compose.yml) da raiz, como antes.
