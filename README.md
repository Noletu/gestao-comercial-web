# Gestão Comercial — Web

SaaS web de gestão comercial para lojistas. MVP: espelho de estoque sincronizado
com a Nuvemshop. Monorepo gerenciado com **Turborepo**.

> Visão, escopo e decisões de arquitetura vivem em [`PROJETO.md`](./PROJETO.md)
> (documento fonte de verdade).

## Stack

- **Monorepo:** Turborepo + npm workspaces
- **Web:** Next.js 14 (App Router) + React 18 + Tailwind CSS
- **API:** Express + TypeScript (TS estrito) + validação de env com Zod
- **Banco:** PostgreSQL + Prisma, multi-tenant via Row-Level Security
- **Deploy:** Railway (dois serviços + Postgres gerenciado) — ver [`DEPLOY.md`](./DEPLOY.md)
- **Qualidade:** ESLint + Prettier (configs compartilhadas em `packages/`)

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
npm run db:migrate         # aplica o schema + o SQL de RLS
npm run db:provision-role  # aplica a senha do app_user a partir de APP_USER_PASSWORD
npm run db:seed            # popula a loja do casal com dados de exemplo
npm run db:studio          # (opcional) abre o Prisma Studio
```

> A migration cria o role `app_user` **sem senha** (GATE 1 da issue #4 — a senha
> nunca vai para o SQL versionado, pois o repo é público). O
> `db:provision-role` aplica a senha de `APP_USER_PASSWORD` (no `.env`); ela deve
> ser igual à embutida no `DATABASE_URL`. Em produção, o Railway roda isso no
> release automaticamente (ver [`DEPLOY.md`](./DEPLOY.md)).

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
