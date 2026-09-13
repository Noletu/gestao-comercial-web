# CLAUDE.md — Gestão Comercial (web)

Regras específicas deste repositório. Têm precedência sobre o CLAUDE.md global
do usuário; onde este arquivo é silencioso, o global vale.

> **Fonte de verdade de produto e arquitetura:** [`PROJETO.md`](./PROJETO.md).
> Setup e scripts: [`README.md`](./README.md). Deploy: [`DEPLOY.md`](./DEPLOY.md).
> Este arquivo cobre convenções de código e o fluxo de agentes — não repete o
> que já está naqueles.

## O que é

SaaS web de gestão comercial para pequenos lojistas. MVP (Épico 1) = **espelho
de estoque** sincronizado com a Nuvemshop (Product API `2025-03`). Multi-tenant
desde o schema (`store_id`/`tenant` em toda tabela de negócio), isolado no banco
por **Row-Level Security**. Fase atual: Épico 0 (fundação) — issue #4 (deploy
Railway) na branch `feat/issue-4-deploy-railway`.

O dono do produto (Lucas) **não é programador**: não lê código, diff nem stack
trace. Julga produto na tela. Toda verificação técnica termina no agente sênior.

## Stack e estrutura

- Monorepo **Turborepo** + npm workspaces. `turbo.json` usa `envMode: "loose"`
  (workaround de variáveis de sistema no Windows — não mudar sem ler o comentário
  lá).
- `apps/web` — Next.js 14 (App Router) + React 18 + Tailwind. Auth via
  `better-auth` (sessão por cookie, 2FA TOTP com `qrcode`).
- `apps/api` — Express (ESM, `"type": "module"`, imports relativos com extensão
  `.js`) + Prisma + PostgreSQL + Zod. Camadas: `routes` → `services` →
  `middlewares` → `lib`. `src/db` (`tenant.ts`, `crypto.ts`, `index.ts`) é o
  núcleo multi-tenant/RLS — área sensível.
- `packages/eslint-config` (`@gestao/eslint-config`) e
  `packages/typescript-config` (`@gestao/typescript-config`).
- Dois roles de banco propositais: `DATABASE_URL` → `app_user` (runtime, sujeito
  a RLS); `DIRECT_DATABASE_URL` → `postgres` (só migrations/seed).
  `npm run db:provision-role` aplica a senha do `app_user` a partir de
  `APP_USER_PASSWORD` (GATE 1 da issue #4: senha fora do SQL versionado).

## Comandos de verificação

Rodar a suíte **antes e depois** de qualquer mudança. Critério: **delta-zero**
de falhas/erros novos.

- **Typecheck:** `npm run typecheck` (raiz, via Turbo — `tsc --noEmit` em `web` e
  `api`). O `tsconfig.json` de `api` **inclui** os testes, então `tsc` cobre
  `src/**/*.test.ts`; o `tsconfig.build.json` os exclui do build.
- **Lint:** `npm run lint` (raiz, via Turbo — `web` e `api`). `api` usa
  `@typescript-eslint` (pega `no-unused-vars`, `any`, etc.); `web` usa
  `next/core-web-vitals` (mais frouxo — o gate real do `web` é o `tsc`).
- **Testes:** `npm test -w api` a partir da raiz. **A suíte vive só em
  `apps/api`** (`vitest`); `npm test` na raiz **não existe** e `apps/web` não tem
  test runner. Os testes de `api` compartilham o mesmo Postgres e rodam em série
  (`fileParallelism: false`) — não presuma isolamento entre arquivos.
- **Desde a gestão manual de estoque (`specs/estoque-manual.md`, Épico 1
  reordenado): o banco de dev é o MESMO onde vive o estoque real do Lucas.**
  Rodar `npm test -w api` ou `npm run db:seed` apaga esse estoque (trunca as
  mesmas tabelas). Depois de rodar qualquer um dos dois, recuperar com
  `npm run db:import-inventory -- "<caminho do .xlsx do Lucas>"` (de dentro de
  `apps/api`) antes de devolver acesso — nunca deixar o Lucas com o banco só
  com dados de teste. Resolver de vez é a issue #3 (banco de teste dedicado),
  ainda aberta.
- **Não há hook que rode isso automaticamente nem que bloqueie fim de turno ou
  commit.** A conferência é responsabilidade de quem edita, e o sênior a refaz.

## Convenções de código

- TypeScript **strict**, sem `any`, sem cast forçado nem `!` non-null para
  esconder problema real.
- Nomes descritivos em inglês. Uma responsabilidade por função.
- **Trate todo erro explicitamente.** Sem `catch` vazio. **Falha silenciosa é
  proibida:** nada de valor inválido seguindo adiante, nada de operação que falha
  enquanto a tela mostra sucesso. Ninguém aqui lê log — erro tem que ser visível
  para quem usa, em linguagem de não-programador.
- Estado "não sei" (taxa/valor indeterminado) se representa com `null` no tipo,
  **nunca** com sentinela (`0`, string vazia) + booleano ao lado. Deixe o
  compilador ser o portão.
- Toda chamada à Nuvemshop trata rate limit e token inválido explicitamente
  (ver regras não-negociáveis em `PROJETO.md` §2).
- Multi-tenant: nenhuma consulta ou mutação escapa do escopo do tenant. Não
  dependa do RLS sem um teste que o prove.
- Remova código morto e `console.log` de debug antes de commitar.
- Ao corrigir um bug, procure o mesmo padrão em outros pontos e reporte os casos
  irmãos.

## Git

- Commits atômicos, **Conventional Commits**, mensagem em português.
- Criar a branch de feature **antes** do primeiro commit de uma tarefa —
  nunca commitar direto em `main`. Se acontecer: criar uma branch nova a
  partir do HEAD atual (`git branch <nova> HEAD`), entrar nela
  (`git switch <nova>` — **não** `git checkout <nova>`, banido logo abaixo),
  e só então mover o ponteiro local de `main` de
  volta com `git branch -f main origin/main` (**nunca** `git reset --hard`,
  proibido pela seção "Nenhum agente apaga arquivo" abaixo). Depois disso,
  push da branch nova e PR — a regra de "nunca faça push sem autorização
  explícita", logo abaixo, continua valendo.
- Nunca commite com falha **nova** na suíte. Nunca `git add -A`/`git add .` —
  adicione por caminho explícito.
- Nunca faça push sem autorização explícita no prompt atual.
- A causa raiz de um bug vai na mensagem de commit ou no corpo do PR — **nunca**
  em comentário no código.
- PR pequeno e revisável. Atualizar `PROJETO.md` quando uma decisão mudar.

## Nenhum agente apaga arquivo

Arquivo não rastreado pelo git não volta — não existe commit que o recupere.
Proibido para **todos** os agentes, por qualquer meio: `rm`, `rm -rf`,
`Remove-Item`, `git clean -fd`, `git checkout -- <arquivo>`, `git checkout .`,
`git checkout <branch>`, `git restore`, `git reset --hard`, `git stash`
(inclusive `-u`), `git rm`, `git mv`, `mv`, `Move-Item`, `truncate`,
`Set-Content`, `Clear-Content`, redirecionar com `>` para arquivo existente, e
sobrescrever arquivo (com vazio **ou com outro conteúdo**, inclusive via `Write`/
`Edit`). "Arrumar a árvore" não é autorização.

Ações disponíveis no lugar: deixar o arquivo onde está e listar o caminho no
relatório; ou, só para arquivo criado na própria sessão, mover para
`C:\Users\Lucas\gestao-comercial-web-quarentena\<AAAA-MM-DD>\` com origem e
destino registrados.

Única exceção: o Lucas pede a remoção **por iniciativa dele**, no prompt atual,
sem que nenhum agente tenha proposto, perguntado ou sugerido. Autorização
provocada não vale.

Trava parcial em `.claude/settings.json` (`permissions.deny`): nega `rm`,
`rmdir`, `git clean`, `git stash`, `git reset --hard`, `truncate` no Bash e
`Remove-Item`, `Clear-Content` + os de git no PowerShell. É rede parcial —
`mv`/`Move-Item`/`Set-Content`/`>`/ferramentas de edição **não** são cobertos.
A regra escrita é mais larga que a trava, e é a regra que vale. Diff que remova
ou afrouxe a proibição de apagar, o carve-out que a protege, ou a chave
`permissions` é **crítico automático** para o revisor e exige aprovação do Lucas.

## Fluxo de agentes

Subagentes em `.claude/agents/`:

- **`senior`** (opus) — conduz: entende o problema com o Lucas, decide
  arquitetura, escreve `specs/<slug>.md` (seção "Como o Lucas valida"
  obrigatória), delega, verifica por conta própria (passo 6: typecheck + lint +
  testes nesta sessão + ler o diff) e reporta em linguagem de produto.
- **`implementador`** (sonnet) — implementa spec fechada; único com `Write`.
- **`revisor`** (sonnet, `memory: project`) — revisa código com contexto limpo,
  depois de toda implementação, antes de aceitar.
- **`revisor-texto`** (sonnet, `memory: project`) — revisa mudanças que tocam
  **só** documento de produto (`.md` que não seja regra/fluxo); recusa e devolve
  ao `revisor` qualquer diff que toque código, `CLAUDE.md`, `HANDOFF.md` ou
  `.claude/`.

Ciclo: entender → investigar → spec (aprovada pelo Lucas) → implementador →
revisor → sênior verifica → reporta. Correção trivial de uma linha o sênior faz
direto, mas passa pelo revisor do mesmo jeito. Nada entra com achado crítico em
aberto.

O ciclo obrigatório acima é a espinha. As skills do Superpowers (brainstorming,
writing-plans, systematic-debugging, test-driven-development,
verification-before-completion) rodam DENTRO dele, nunca no lugar dele.
Instrução explícita do Lucas ou spec fechada têm prioridade sobre qualquer skill.

**Exceção (decisão do Lucas):** tarefa de *infraestrutura do próprio fluxo* —
hooks, `.claude/agents/*.md`, `.claude/settings.json`, scripts de verificação do
`package.json`, este CLAUDE.md — dispensa spec e aprovação prévia (ele não tem
como julgar o conteúdo). Continua obrigatório passar pelo revisor (com um
parágrafo de "o que deve passar a ser verdade, e como se mede" no lugar da spec)
e reportar. O que **muda comportamento do aplicativo** nunca cai nessa exceção.

## Versionamento do `.claude/`

- **Versionados:** `.claude/agents/*.md` e `.claude/settings.json`.
- **Ignorados de propósito** (`.gitignore`): `.claude/agent-memory/` e
  `.claude/settings.local.json`. Memória de subagente é escrita sem revisão
  humana; aprendizado durável pertence a este arquivo, que passa por revisão.
  Ausência da memória num clone novo **não é bug**.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
