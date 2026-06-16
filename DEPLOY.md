# Deploy no Railway

Guia do deploy de produção da Gestão Comercial no **Railway**: dois serviços
(`api` e `web`) a partir deste monorepo + um **Postgres gerenciado** no mesmo
projeto (rede privada interna). É o deploy que dá à API uma **URL pública estável**
— pré-requisito para testar o OAuth da Nuvemshop (PR #12).

> **Importante:** os passos marcados com 🖱️ são **cliques seus no painel do
> Railway** (não há como automatizá-los daqui). O repositório já traz toda a
> configuração necessária (`railway.json` de cada serviço, scripts de release,
> ajustes de cookie/CORS). Você cola os secrets e gera os domínios.

---

## Decisões deste deploy (o "porquê")

- **Postgres gerenciado no próprio Railway**, na rede privada do projeto. Tudo num
  lugar; a API fala com o banco pelo host interno (`*.railway.internal`), sem
  expor o banco à internet.
- **Pooling: o pool nativo do Prisma conectando direto ao Postgres** (sem
  PgBouncer). Por que é seguro com o RLS: o contexto de tenant é setado com
  `set_config('app.tenant_id', …, true)` — o `true` é **LOCAL à transação**, então
  o valor morre no commit/rollback e a conexão volta ao pool "limpa". As policies
  ainda usam `NULLIF(current_setting(...), '')` (fail-closed). Isso é provado pelo
  teste `rls.pooling.test.ts` (reuso forçado da mesma conexão, `connection_limit=1`).
  Se um dia adicionarmos o **PgBouncer em transaction mode**, a mesma garantia
  vale (o contexto é por transação) — bastaria acrescentar `?pgbouncer=true` à
  `DATABASE_URL` (desliga prepared statements, exigência do Prisma com PgBouncer).
- **Migrations e provisionamento rodam no release**, não no build. O start de
  produção da API é `prisma migrate deploy && node scripts/provision-db-role.mjs
&& node dist/index.js` (`start:prod`). Idempotente: pode rodar a cada deploy.
- **Seed NÃO roda automático em produção** (evita recriar/sobrescrever dados).
  Roda **uma vez, manualmente** (passo 8).
- **Cookies cross-domínio**: em produção `web-*.up.railway.app` e
  `api-*.up.railway.app` são **domínios diferentes**. O cookie de sessão passa a
  `SameSite=None; Secure` (em dev continua `Lax`), senão o navegador não o envia
  nas chamadas cross-site com `credentials`. A API também liga `trust proxy` para
  reconhecer o HTTPS terminado no proxy do Railway.

---

## Pré-requisitos

- Repositório `Noletu/gestao-comercial-web` no GitHub (já existe).
- Conta no Railway com acesso ao GitHub.
- O `client_secret` do app Nuvemshop (portal do app 34160).

---

## Passo a passo (🖱️ = clique seu no painel)

### 1. 🖱️ Criar o projeto e conectar o repo

1. Railway → **New Project** → **Deploy from GitHub repo** → escolha
   `Noletu/gestao-comercial-web`.
2. O Railway cria um primeiro serviço a partir do repo. Renomeie-o para **`api`**
   (vamos configurá-lo no passo 3).

### 2. 🖱️ Adicionar o Postgres gerenciado

1. No projeto → **New** → **Database** → **Add PostgreSQL**.
2. Aguarde subir. Ele expõe variáveis (`DATABASE_URL`, `PGHOST`, `PGPORT`,
   `PGUSER`, `PGPASSWORD`, `PGDATABASE`) que vamos **referenciar** nos serviços.
   **Crie o Postgres ANTES de fazer o primeiro deploy da api** (a api precisa do
   banco no boot).

### 3. 🖱️ Configurar o serviço `api`

No serviço `api` → **Settings**:

- **Root Directory:** `/` (raiz do repo — necessário para o npm workspaces
  instalar tudo).
- **Config File / Railway Config:** `apps/api/railway.json` (build, start e
  healthcheck já vêm de lá — inclusive `healthcheckPath = /health`).

Em **Variables**, cole os secrets do passo 5 **antes** do primeiro deploy. Só
então faça o deploy (o release roda `migrate deploy` + provisiona o role).

### 4. 🖱️ Criar o serviço `web`

1. No projeto → **New** → **GitHub Repo** → o mesmo `Noletu/gestao-comercial-web`.
2. Renomeie para **`web`**. Em **Settings**:
   - **Root Directory:** `/`
   - **Config File:** `apps/web/railway.json`
3. Em **Variables**, defina `NEXT_PUBLIC_API_URL` (passo 5). ⚠️ O Next **embute**
   `NEXT_PUBLIC_*` no **build**; essa variável precisa existir **antes** do build,
   e mudá-la exige **rebuild** (não só restart).

### 5. 🖱️ Secrets e variáveis (onde colar e como gerar)

**Como gerar valores fortes:**

- `ENCRYPTION_KEY` (base64, 32 bytes):
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `BETTER_AUTH_SECRET` e `APP_USER_PASSWORD`: botão **Generate** do Railway (32
  chars) ou `openssl rand -base64 32`. (Evite `'` na senha do app_user.)

**Serviço `api` — Variables:**

| Variável                  | Valor                                                                                                             | Origem                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `NODE_ENV`                | `production`                                                                                                      | você                               |
| `DIRECT_DATABASE_URL`     | `${{Postgres.DATABASE_URL}}`                                                                                      | **referência** ao Postgres (owner) |
| `APP_USER_PASSWORD`       | _(gere 32 chars)_                                                                                                 | secret seu                         |
| `DATABASE_URL`            | `postgresql://app_user:${{APP_USER_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` | composta (runtime = app_user)      |
| `ENCRYPTION_KEY`          | _(base64 de 32 bytes)_                                                                                            | secret seu                         |
| `BETTER_AUTH_SECRET`      | _(32+ chars)_                                                                                                     | secret seu                         |
| `BETTER_AUTH_URL`         | `https://<DOMÍNIO-PÚBLICO-DA-API>`                                                                                | passo 6                            |
| `WEB_ORIGIN`              | `https://<DOMÍNIO-PÚBLICO-DA-WEB>`                                                                                | passo 6                            |
| `NUVEMSHOP_CLIENT_ID`     | `34160`                                                                                                           | você                               |
| `NUVEMSHOP_CLIENT_SECRET` | _(do portal do app)_                                                                                              | secret seu                         |
| `NUVEMSHOP_REDIRECT_URI`  | `https://<DOMÍNIO-PÚBLICO-DA-API>/api/nuvemshop/callback`                                                         | passo 6                            |
| `SEED_OWNER1_EMAIL`       | e-mail do sócio 1                                                                                                 | você (usado só no seed)            |
| `SEED_OWNER2_EMAIL`       | e-mail do sócio 2                                                                                                 | você (usado só no seed)            |
| `SEED_OWNER_PASSWORD`     | senha inicial forte                                                                                               | secret seu (usado só no seed)      |

> **Não** defina `PORT` — o Railway injeta a porta e o código a lê de `process.env.PORT`.
>
> A senha embutida em `DATABASE_URL` (via `${{APP_USER_PASSWORD}}`) e o
> `APP_USER_PASSWORD` que o `provision-db-role` aplica **são a mesma variável** —
> por construção elas batem.
>
> Os nomes exatos das variáveis do Postgres (`PGHOST`/`PGPORT`/`PGDATABASE`)
> aparecem na aba **Variables** do serviço Postgres; confira e ajuste a referência
> se o seu projeto usar nomes diferentes.

**Serviço `web` — Variables:**

| Variável              | Valor                              | Observação                         |
| --------------------- | ---------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_API_URL` | `https://<DOMÍNIO-PÚBLICO-DA-API>` | **build-time** (passo 6 → rebuild) |

### 6. 🖱️ Gerar os domínios públicos e fechar as URLs cruzadas

1. `api` → **Settings → Networking → Generate Domain**. Copie a URL
   (`https://api-...up.railway.app`).
2. `web` → **Settings → Networking → Generate Domain**. Copie a URL
   (`https://web-...up.railway.app`).
3. Volte às Variables e preencha com esses valores:
   - `api`: `BETTER_AUTH_URL` e `NUVEMSHOP_REDIRECT_URI` (domínio da **api**);
     `WEB_ORIGIN` (domínio da **web**).
   - `web`: `NEXT_PUBLIC_API_URL` (domínio da **api**) → **Redeploy a web**
     (rebuild para embutir a URL).
4. No **portal da Nuvemshop** (app 34160), cadastre a **URL de redirecionamento**
   = o mesmo valor de `NUVEMSHOP_REDIRECT_URI`.

### 7. Migrations + role (automático no release)

Nada manual aqui: o `start:prod` da api roda, a cada deploy,
`prisma migrate deploy` (aplica o schema) e depois
`node scripts/provision-db-role.mjs` (aplica a senha do `app_user` a partir de
`APP_USER_PASSWORD`). É idempotente. Acompanhe em **Deploy Logs** da api: deve
aparecer `✅ Senha do role app_user provisionada a partir do ambiente.`

### 8. Seed inicial (🖱️ uma única vez)

O seed **não** roda no deploy. Para popular o casal/loja uma vez, use a **Railway
CLI** na sua máquina apontando para o ambiente de produção:

```bash
npm i -g @railway/cli
railway login
railway link          # escolha o projeto; selecione o serviço "api"
railway run --service api npm run db:seed --workspace api
```

`railway run` injeta as variáveis de produção (inclusive `DIRECT_DATABASE_URL` e
os `SEED_*`) no comando local. Rode **uma vez**; repetir recria os dados de
exemplo.

### 9. O que você deve ver funcionando

- `GET https://<api>/health` → **200** `{ "status": "ok", ... }`.
- Abrir `https://<web>` → tela de login; logar com `SEED_OWNER1_EMAIL` /
  `SEED_OWNER_PASSWORD` → cai no `/dashboard` (cookie de sessão cross-domínio
  funcionando).
- Deploy Logs da api sem erros de env (o boot **falha de propósito** se faltar
  `DATABASE_URL`/`ENCRYPTION_KEY`/`BETTER_AUTH_SECRET`).

---

## Ordem resumida (não pule)

**Postgres → secrets da api → 1º deploy da api → web → gerar domínios → fechar
URLs cruzadas → rebuild da web → seed (uma vez).**

## Próximos passos (fora do escopo desta issue)

- Testar o **OAuth da Nuvemshop** (PR #12) usando a URL pública da api agora que
  ela existe.
- Eventual **domínio próprio** (hoje usamos o domínio Railway).
