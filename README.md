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

## Variáveis de ambiente

Veja [`.env.example`](./.env.example). Hoje a API valida apenas `PORT` e
`NODE_ENV` (esquema em `apps/api/src/lib/env.ts`); se algo estiver inválido, ela
**falha no boot** — de propósito, para o erro aparecer no deploy e não num
request em produção.

> **Segredos nunca entram no repositório.** `client_id`/`client_secret` da
> Nuvemshop e a `DATABASE_URL` vivem apenas no `.env` local (ignorado pelo git)
> e nas variáveis de ambiente do Railway.
