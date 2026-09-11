# Estoque com busca por código, filtro de estoque baixo e preço

> Status: aprovado pelo Lucas em conversa (brainstorming), 2026-09-11.
> Estende `specs/estoque-manual.md` (v1, já entregue e em uso). Não reabre
> nenhuma decisão daquela spec além do que este documento lista explicitamente.

## 1. Objetivo

A gestão manual de estoque (spec anterior) resolveu consultar/lançar/ajustar
quantidade. Falta o resto do que o Lucas precisa pra abandonar de vez a
planilha: achar uma peça pelo código (não só pelo nome), saber quais peças
estão acabando sem precisar rolar a lista toda, e ver preço/custo/margem —
hoje cadastrados em lugar nenhum da tela. Também falta poder corrigir um
cadastro depois de criado (nome, código ou preço errado não tem conserto pela
tela hoje).

Uso: computador, no dia a dia da loja.

## 2. Fora de escopo (decisão do Lucas, brainstorming desta sessão)

- Categoria e fornecedor — não existem no cadastro hoje; criar os dois campos
  é mudança de schema sem necessidade comprovada. Fica pra quando o Lucas
  pedir.
- Múltiplas variações por produto (tamanho, cor) — sistema continua 1
  produto = 1 peça, como a spec anterior já decidiu.
- Limite de estoque baixo configurável por peça — fixo em 2 pra loja toda
  (decisão do Lucas). Configurável por peça é outra conversa.
- Qualquer mudança nas rotas de movimentação (`POST /api/products/:id/movements`)
  ou na lógica de lock/saldo negativo — `inventory.service.ts` não é tocado
  por esta spec.

## 3. Modelo de dados

**Nenhuma migração nova.** `Variant.price` e `Variant.cost` (`Decimal?`) já
existem no schema (criados na spec anterior, nunca usados). Margem não é
armazenada — é sempre calculada na hora, a partir de `price`/`cost`.

## 4. Regras de negócio

### 4.1 Busca

`GET /api/products?q=<termo>` passa a casar por nome do produto **ou** SKU da
variante (hoje só nome). Case-insensitive, `contains`, nos dois campos —
basta um dos dois bater.

### 4.2 Filtro de estoque baixo

`GET /api/products?lowStock=true` retorna só peças com estoque ≤ 2 (inclui
zerado). Combina com `q` quando os dois vêm juntos (busca E filtro, não OU).

Classificação de estoque, usada tanto no filtro quanto na tela (constante
nomeada no service, ex. `LOW_STOCK_THRESHOLD = 2`):
- `zerado`: `stock === 0`
- `baixo`: `0 < stock <= 2`
- `ok`: `stock > 2`

Implementação: filtrar em memória depois de montar a lista (dataset pequeno,
~100-200 itens — não vale a complexidade de expressar isso em SQL/Prisma
via `having` num agregado que hoje é lido de `InventoryLevel` direto).

### 4.3 Preço, custo e margem

- `price` e `cost` são opcionais (mesma filosofia do SKU: "não sei o valor"
  é `null`, nunca `0` disfarçado de valor real).
- Margem = `(price - cost) / price * 100`, só quando os dois estão
  preenchidos **e** `price > 0`. Qualquer outro caso (um dos dois ausente,
  ou `price === 0`) a margem é `null` — a tela mostra "—", nunca `0%`, `NaN`
  ou `Infinity`.
- `GET /api/products` passa a incluir `price`, `cost` e `margin` (número ou
  `null`) em cada item, além dos campos que já retorna.

### 4.4 Cadastro (`POST /api/products`)

Ganha `price?` e `cost?` no corpo, ambos opcionais, número ≥ 0 quando
enviados (rejeitar negativo com 400 — mensagem clara, mesmo padrão dos
outros campos da rota). Continua sem obrigatoriedade: Lucas pode cadastrar só
nome (e opcionalmente SKU) igual hoje, e preencher preço depois pela edição.

### 4.5 Edição (`PATCH /api/products/:variantId`, rota nova)

Corpo: `{ name, sku?, price?, cost? }` — `name` obrigatório (não pode ficar
vazio), os demais opcionais. **Semântica de substituição total**: o campo
omitido ou vazio limpa o valor (vira `null`/`undefined` no banco), não
"mantém o que já tinha" — o formulário da tela sempre envia o estado atual
completo (pré-preenchido), então não existe update parcial de fato, só o
usuário apagando um campo que não quer mais preenchido.

Atualiza `Product.name` (via `productId` da variante) e
`Variant.sku`/`price`/`cost` numa única transação (`withTenant`) — mesmo
motivo do `createProduct`: nunca um fica atualizado e o outro não.

SKU duplicado: mesma regra do cadastro — captura `P2002` e responde 400 com
"Esse código já está sendo usado por outro produto.", nunca 500. Preço/custo
negativo: 400 com mensagem clara, mesmo padrão do cadastro.

`productId`/`name` da variante em si não muda de "dono" (a variante já
pertence a um produto e isso não é editável aqui) — só os campos citados.

## 5. API — resumo do que muda em `apps/api/src/routes/products.route.ts`

- `GET /api/products?q=&lowStock=` — query, ambos opcionais, ver 4.1/4.2.
  Itens da resposta ganham `price`, `cost`, `margin` (ver 4.3).
- `POST /api/products` — corpo ganha `price?`, `cost?` (ver 4.4).
- `PATCH /api/products/:variantId` — rota nova (ver 4.5).

Lógica de busca/filtro/margem/edição fica em `products.service.ts` (mesmo
padrão de hoje: rota só valida forma do corpo via Zod e chama o service).
`inventory.service.ts` não muda.

**Teste automatizado obrigatório:**
- `listProducts`: busca por SKU (além de nome, já coberto); `lowStock` traz
  só ≤ 2 (inclui 0) e não traz o resto; `q` + `lowStock` juntos combinam
  (E, não OU); `margin` calculada certo, incluindo os casos `null` (sem
  price, sem cost, `price === 0`).
- `createProduct`: aceita `price`/`cost`; rejeita negativo.
- `updateProduct` (novo): atualiza nome/sku/price/cost; SKU duplicado vira
  `ProductValidationError` (400), não 500; limpar um campo (enviar vazio)
  grava `null`; isolamento de tenant (não edita variante de outra loja —
  mesmo padrão dos testes de isolamento já existentes em
  `products.route.test.ts`).

## 6. Web — `apps/web/app/dashboard/page.tsx`

Troca a lista em cartões por **tabela** (decisão do Lucas: uso principal é
computador). Colunas: Peça (nome), Código (SKU), Preço/Custo/Margem, Estoque,
Ações.

- Busca: mesmo campo que já existe, placeholder atualizado pra deixar claro
  que busca por nome ou código.
- Filtro: checkbox/toggle "Só estoque baixo" ao lado da busca, dispara
  `lowStock=true` na mesma chamada.
- Aviso no topo, só quando houver algum item ≤ 2: "N peça(s) com estoque
  baixo" (N = contagem vinda da própria lista carregada, sem chamada extra).
- Coluna Estoque com selo colorido por situação (zerado / baixo / ok — 4.2),
  igual ao que já existe em espírito no aviso.
- Preço/Custo/Margem: formatados em R$ e %; célula mostra "—" onde o valor é
  `null` (nunca `R$ NaN`, nunca `0%` fingindo que é zero de verdade).
- Ação "Editar" por linha: abre formulário com nome, código, preço, custo
  pré-preenchidos; salvar chama `PATCH`; erro do backend (código duplicado,
  valor negativo) aparece na tela, em português, sem falha silenciosa —
  mesmo padrão de `extractErrorMessage` já usado no arquivo.
- Ação "Registrar movimentação" continua como está, sem mudança de
  comportamento.
- Cadastro ("Novo produto"): ganha campos preço e custo, opcionais, mesmo
  formulário existente.
- Sem componente de UI novo além da tabela — Tailwind, mesmo padrão visual
  das telas já existentes. Sem framework de tabela (nenhuma paginação,
  ordenação por coluna ou virtualização — ~100-200 linhas rendeva direto sem
  problema de performance perceptível).

Sem teste automatizado do lado web (o projeto não tem test runner em
`apps/web` — validação é o Lucas clicando, seção 7).

## 7. Como o Lucas valida

1. Abrir `http://localhost:3000`, logar como já faz hoje.
2. A tela de estoque agora é uma tabela, com colunas de preço, custo, margem
   e estoque.
3. Buscar por um **código** (SKU) de uma peça que você sabe que existe e ver
   ela aparecer sozinha na lista (hoje só busca funciona por nome).
4. Marcar "Só estoque baixo" e ver a lista mostrar só as peças com 2 unidades
   ou menos — desmarcar e ver a lista completa voltar.
5. Abrir "Editar" numa peça, mudar o preço de venda e o custo, salvar, e ver
   a margem calculada aparecer na linha.
6. Tentar editar o código de uma peça pro código de outra peça já existente,
   e ver a tela recusar com uma mensagem clara (não travar, não sumir com o
   dado).
7. Cadastrar uma peça nova já com preço e custo preenchidos, e ver ela
   aparecer na tabela com a margem certa.
8. Deixar o campo de custo em branco na edição de uma peça que tinha custo
   preenchido, salvar, e ver a coluna de margem virar "—" (não "0%", não
   travar).

## 8. Fora desta spec, decisões futuras já sinalizadas

- Categoria, fornecedor: seção 2.
- Limite de estoque baixo configurável por peça: seção 2.
- Nuvemshop (issue #12), deploy Railway (issue #4): já sinalizadas na spec
  anterior, continuam fora.
