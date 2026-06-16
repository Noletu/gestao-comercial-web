# Gestão Comercial — Web

SaaS web de gestão comercial para lojistas. MVP: espelho de estoque sincronizado
com a Nuvemshop. Monorepo gerenciado com **Turborepo**.

> Visão, escopo e decisões de arquitetura vivem em [`PROJETO.md`](./PROJETO.md)
> (documento fonte de verdade).

## Stack

- **Monorepo:** Turborepo + npm workspaces
- **Web:** Next.js 14 (App Router) + React 18 + Tailwind CSS
- **API:** Express + TypeScript (TS estrito) + validação de env com Zod
- **Qualidade:** ESLint + Prettier (configs compartilhadas em `packages/`)
- _Banco (Prisma + PostgreSQL) e deploy (Railway) chegam nas próximas issues._

## Estrutura

```
apps/
  web/   → frontend Next.js 14
  api/   → backend Express (camadas: routes, services, middlewares, lib)
packages/
  eslint-config/       → config ESLint compartilhada
  typescript-config/   → tsconfig base compartilhado
```

## Pré-requisitos

- Node.js >= 18 (testado em 22)
- npm 11+

## Setup local

```bash
# 1. Instalar dependências (na raiz, instala todos os workspaces)
npm install

# 2. Criar o arquivo de ambiente a partir do exemplo
#    (no Windows/PowerShell: Copy-Item .env.example .env)
cp .env.example .env

# 3. Subir web (porta 3000) e api (porta 3001) juntos
npm run dev
```

- Web: http://localhost:3000
- API health: http://localhost:3001/health → `{ "status": "ok", "timestamp": "..." }`

## Scripts da raiz (via Turborepo)

| Comando             | O que faz                               |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Sobe web + api em modo desenvolvimento  |
| `npm run build`     | Build de produção de todos os apps      |
| `npm run lint`      | Lint de todos os workspaces             |
| `npm run typecheck` | Checagem de tipos (sem emitir arquivos) |
| `npm run format`    | Formata o repositório com o Prettier    |

## Banco de dados (Postgres + Prisma)

O backend usa Postgres com **Row-Level Security** para isolamento multi-tenant. São
dois roles de propósito: `app_user` (runtime, RLS aplicado) e `postgres` (owner,
migrations/seed). Veja `apps/api/prisma/schema.prisma` e a migration inicial.

### 1. Subir o Postgres

**Recomendado — Docker** (`docker-compose.yml`, porta 5432):

```bash
docker compose up -d
```

**Sem Docker** — se você já tem o PostgreSQL instalado, há um script que cria um
cluster local isolado na porta **5433** (não toca no seu Postgres principal):

```bash
# PowerShell, na raiz do repo
./scripts/dev-db.ps1 start    # cria (se preciso) e inicia
./scripts/dev-db.ps1 stop     # para
./scripts/dev-db.ps1 reset    # apaga e recria do zero
```

### 2. Configurar o env do backend

```bash
# Copie o exemplo e ajuste a porta (5432 Docker / 5433 script sem Docker)
cp apps/api/.env.example apps/api/.env
```

### 3. Migrar e popular

```bash
cd apps/api
npm run db:migrate   # aplica o schema + o SQL de RLS
npm run db:seed      # popula a loja do casal com dados de exemplo
npm run db:studio    # (opcional) abre o Prisma Studio
```

### Testes de integração do banco

```bash
cd apps/api
npm test             # isolamento RLS entre tenants + consistência ledger↔estoque
```

> Os testes **truncam** as tabelas de negócio; rode `npm run db:seed` depois para
> repovoar. (Atenção: usam o mesmo banco de dev — ver sugestão de banco de teste
> dedicado no histórico da issue #2.)

## Variáveis de ambiente

Backend: [`apps/api/.env.example`](./apps/api/.env.example). A API valida o env no
boot com Zod (`apps/api/src/lib/env.ts`); se algo estiver inválido (ex.: falta
`DATABASE_URL` ou `ENCRYPTION_KEY`), ela **falha no boot** — de propósito, para o
erro aparecer no deploy e não num request em produção.

> **Segredos nunca entram no repositório.** `client_id`/`client_secret` da
> Nuvemshop, a `DATABASE_URL` e a `ENCRYPTION_KEY` vivem apenas no `.env` local
> (ignorado pelo git) e nas variáveis de ambiente do Railway.

## Conexão com a Nuvemshop (OAuth)

O fluxo conecta uma loja Nuvemshop ao tenant logado: iniciar instalação →
callback com o `code` → troca por `access_token` (server-side) → conexão
persistida **cifrada** (AES-256-GCM). O token **não expira** (só invalida em
reinstalação/desinstalação), então não há refresh token. Detalhes do desenho em
[`apps/api/src/nuvemshop/`](./apps/api/src/nuvemshop/).

### Por que precisa de um túnel em dev

A Nuvemshop redireciona o `code` para uma **URL pública** (o callback);
`localhost` não é acessível por ela. Em dev, expomos a API local (porta 3001) com
um túnel (**ngrok** ou **cloudflared**). A URL do callback é **configurável por
env** (`NUVEMSHOP_REDIRECT_URI`) para alternar entre túnel (dev) e Railway (prod)
sem mudar código.

### Passo a passo (dev)

```bash
# 1. Suba a API e o front (raiz do repo)
npm run dev

# 2. Suba o túnel apontando para a API (porta 3001)
ngrok http 3001
#   → copie a URL https pública, ex.: https://abc123.ngrok-free.app
#   (cloudflared: `cloudflared tunnel --url http://localhost:3001`)
```

3. No **portal da Nuvemshop** (app 34160), defina a **"URL de redirecionamento"**
   para `https://SEU-TUNEL/api/nuvemshop/callback`.
4. No `apps/api/.env`, defina o **mesmo** valor em `NUVEMSHOP_REDIRECT_URI` e
   preencha `NUVEMSHOP_CLIENT_SECRET` (do portal). Reinicie a API.
5. No painel (`/dashboard`), clique **"Conectar Nuvemshop"**, autorize na loja
   demo **Regototeste (#7837533)** e volte. Sucesso → o card mostra
   _"Conectada — loja {nome}"_ (o nome vem de uma chamada real a `GET /store`).

> O endpoint de **troca de token** (`www.nuvemshop.com.br/apps/authorize/token`)
> fica em host diferente da **API de recursos**
> (`api.nuvemshop.com.br/{versão}/{store_id}`). E a Nuvemshop autentica pelo
> header **`Authentication: bearer …`** (não `Authorization`) — ambos já tratados
> no cliente HTTP.
