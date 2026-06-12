# Gestão Comercial — Documento Fundador (v1.1)

> Documento vivo. Fonte única de verdade para arquitetura, escopo e decisões.
> Workflow: planejamento aqui (Claude web) → execução via prompts no Claude Code.
> v1.1 (11/06/2026): providências Nuvemshop concluídas (app_id 34160, demo store
> Regototeste); domínios padronizados em `.nuvemshop.com.br`; nota Tiendanube.

---

## 1. Visão e estratégia

**Produto:** SaaS web de gestão comercial para pequenos lojistas, começando pela
própria loja de roupas femininas e evoluindo para comercialização a terceiros.

**Princípio que governa tudo:** o MVP resolve UMA dor real, bem feita. Não é um
ERP. "Tudo em um lugar" é o destino, não o ponto de partida.

**Dor #1 escolhida:** controle de estoque sincronizado com a Nuvemshop, acessível
no PC e no celular pelo casal.

**Por que web/SaaS e não Electron:** o objetivo de comercializar exige acesso
multi-dispositivo, suporte remoto, cobrança recorrente e zero fricção de
instalação. O app Electron existente (`Noletu/Gestao-Comercial`) cumpriu o papel
de protótipo de validação de domínio — sua lógica de precificação, SKU e custo de
viagem será reaproveitada na Fase 2, mas a arquitetura é descartada.

---

## 2. Decisões de arquitetura (ADRs resumidas)

| # | Decisão | Razão |
|---|---------|-------|
| 01 | Stack: Next.js 14 + Express + TypeScript + Prisma + PostgreSQL | Mesmo do MktPlace-P2P; domínio já dominado; workflow Claude web→Code já estabelecido |
| 02 | Deploy: Railway | Já em uso pelo time; simples para começar |
| 03 | Multi-tenant desde o schema (campo `store_id`/`tenant` em todas as tabelas de negócio) | Permite vender a terceiros sem refazer o banco, mesmo com 1 loja hoje |
| 04 | Integração Nuvemshop via nova Product API versionada (`2025-03`), NÃO a `v1` legada | Recomendação oficial; suporte a multi-inventory |
| 05 | Sync inicial via fila com throttle respeitando Leaky Bucket (40 cap, 2 req/s) | Limite oficial da API; evita bloqueio |
| 06 | Token Nuvemshop persistido criptografado por loja (não expira) | Modelo OAuth deles; guardar uma vez por loja |
| 07 | App tipo "Para Seus Clientes" no início (sem homologação); app público "App Store" só na Fase 3 | Caminho técnico idêntico; auditoria só ao comercializar |
| 08 | Conta Partner no email do projeto: `regotodigital@gmail.com` (marca Regoto Digital) | Separa identidade do produto da pessoa física; mesmo email vai no User-Agent obrigatório |
| 09 | Desenvolver contra "demo store" antes de conectar a loja real | Protege o estoque real durante o desenvolvimento |

### ⚠️ Risco/prazo registrado: NubeSDK
A Nuvemshop está tornando o NubeSDK obrigatório:
- 05/06/2026 — obrigatório em homologação (afeta SÓ a Fase 3, app público).
- 30/08/2026 — novas instalações bloqueadas para apps sem SDK.
- Lojas com app já instalado continuam funcionando após 30/08/2026.
- O requisito mira apps que **injetam scripts no front da loja**. Nosso MVP NÃO
  injeta script (é painel externo via API), então **não bloqueia Fase 0/1/2**.
- **Ação:** avaliar adoção do NubeSDK ao planejar a Fase 3 (comercialização).

### Regras de implementação não-negociáveis (da doc oficial Nuvemshop)
- Header `User-Agent: GestaoComercial (regotodigital@gmail.com)` em TODA requisição. Obrigatório.
- Header `Authorization: Bearer {access_token}`.
- Base URL: `https://api.nuvemshop.com.br/2025-03/{store_id}/...`
  - Nota: `api.tiendanube.com` é o MESMO serviço (Tiendanube = nome da Nuvemshop
    em espanhol). Os domínios são intercambiáveis; padronizamos no `.com.br`.
- Authorization code expira em 5 min — trocar por token imediatamente no callback.
- Paginação obrigatória (`page`, `per_page`) — nunca assumir que 1 página basta.
- Estoque/preço/custo/SKU vivem na **variante**, não no produto.
- Respeitar rate limit: toda chamada em massa passa por fila com throttle.

---

## 3. Escopo do MVP (TRAVADO)

### Dentro do MVP (Épico 1 + 2)
- Login do casal (auth simples, 2 usuários).
- Conectar a loja Nuvemshop via OAuth (instalar 1x).
- Sincronizar produtos + variações + estoque da Nuvemshop para o nosso banco.
- Painel de estoque responsivo (PC + celular): lista, busca, filtro.
- Alerta visual de estoque baixo (limite configurável por produto).
- Registrar entrada de mercadoria → reflete de volta na Nuvemshop (PUT na variante).
- Manter sincronizado via webhook `product/updated`.

### FORA do MVP (explicitamente adiado)
- Precificação automática e custo de viagem (Fase 2 — reaproveita Electron).
- Dashboard de lucro / margem (Fase 2).
- Pedidos/vendas, PDV (Fase 2+).
- Multi-loja real, billing, onboarding de terceiros (Fase 3).
- Relatórios, código de barras, mobile nativo.

> Regra: qualquer pedido novo durante o desenvolvimento vira issue no backlog,
> NÃO entra no épico atual. Escopo do épico é congelado quando começa.

---

## 4. Roadmap por fases

- **Fase 0 — Fundação** (~1 semana): repo novo, scaffolding do stack, deploy
  Railway, auth do casal, schema multi-tenant base.
- **Fase 1 — MVP Espelho de Estoque** (~3–4 semanas): OAuth Nuvemshop, sync,
  painel, alerta, entrada de mercadoria, webhook. → **Usar de verdade na loja.**
- **Fase 2 — Camada de lucro** (~3–4 semanas): migrar lógica de precificação e
  viagem do Electron; margem real.
- **Fase 3 — Comercialização**: app público homologado, billing, onboarding.

---

## 5. Backlog — Épico 0 (Fundação) → vira Issues no GitHub

- [ ] **#1 chore: scaffolding do monorepo/projeto** — Next.js 14 + Express +
  TS + Prisma + Postgres, ESLint/Prettier, estrutura de pastas, Conventional Commits.
- [ ] **#2 chore: configurar Postgres + Prisma + primeira migration** — schema
  base com `Tenant`/`Store`, `User`, relação multi-tenant.
- [ ] **#3 feat: auth do casal** — login simples para 2 usuários, sessão segura.
- [ ] **#4 chore: deploy inicial no Railway** — app no ar com healthcheck.
- [ ] **#5 docs: README + este PROJETO.md versionado no repo.**

## 6. Backlog — Épico 1 (MVP Espelho de Estoque) → vira Issues

- [ ] **#6 feat: criar app na Nuvemshop + fluxo OAuth** — instalar, callback,
  trocar code por token, persistir token criptografado + `store_id` por tenant.
- [ ] **#7 feat: cliente HTTP Nuvemshop** — wrapper com User-Agent obrigatório,
  Bearer, base URL versionada, paginação automática, throttle (Leaky Bucket).
- [ ] **#8 feat: sync inicial de produtos/variações/estoque** — fila com throttle,
  upsert no Postgres, registro de última sincronização.
- [ ] **#9 feat: painel de estoque responsivo** — lista, busca, filtro, indicador
  de estoque; mobile-first.
- [ ] **#10 feat: alerta de estoque baixo** — limite configurável por produto,
  destaque visual.
- [ ] **#11 feat: registrar entrada de mercadoria** — formulário → PUT na variante
  da Nuvemshop → atualiza banco local.
- [ ] **#12 feat: webhook product/updated** — endpoint que recebe e atualiza
  estoque local em tempo real (responder 2XX em <3s).
- [ ] **#13 test: cobertura dos fluxos críticos** — OAuth, sync, entrada, webhook.

---

## 7. Definition of Done (por issue)
- Código tipado (TS estrito), sem `any` solto, sem warning de lint.
- Tratamento de erro explícito nas chamadas à Nuvemshop (rate limit, token inválido).
- Teste cobrindo o caminho feliz + ao menos 1 caminho de erro.
- Commit em Conventional Commits, PR pequeno e revisável.
- Atualizar este documento se uma decisão mudar.

---

## 8. Próximo passo imediato
~~Providências Nuvemshop~~ ✅ feitas. Agora: criar o repo `gestao-comercial-web`,
commitar este documento em `docs/PROJETO.md`, abrir as Issues do Épico 0 e rodar
o primeiro prompt no Claude Code (issue #1: scaffolding).

### Providências externas (Noletu) — ✅ CONCLUÍDAS em 11/06/2026
1. ✅ Conta Partner criada em partners.nuvemshop.com.br (`regotodigital@gmail.com`, perfil Desenvolvedor).
2. ✅ Aplicação criada — **app_id: 34160**, tipo **"Para Seus Clientes"** (sem homologação).
3. ✅ Loja demo criada e vinculada: **"Regototeste" (#7837533)** — todo o desenvolvimento
   acontece contra ela; a loja real só conecta após validação completa.
4. ✅ `client_id` e `client_secret` obtidos. **Vivem APENAS no `.env` local e nas
   variáveis de ambiente do Railway. NUNCA no repo, em issue, ou em chat.**
5. ✅ Permissão "Products" (padrão) — suficiente para o MVP.
6. ✅ URL de redirecionamento: mantido o link automático de testes do portal
   (`partners.nuvemshop.com.br/applications/authentication/34160`).
   **Pendência futura:** trocar pela URL de produção no Railway
   (`https://<app>.up.railway.app/api/nuvemshop/callback`) quando o deploy existir,
   e preencher "Site do aplicativo" com a mesma base.
