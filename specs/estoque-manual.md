# Gestão manual de estoque (v1, sem Nuvemshop)

> Status: aprovado pelo Lucas em conversa (brainstorming), 2026-09-10.
> Reordena o roadmap do PROJETO.md: o painel de estoque nasce manual, antes da
> sincronização com a Nuvemshop (issue #12, ainda não mesclada). Este documento
> não substitui o PROJETO.md — quando a spec for aceita, atualizar a seção
> "Roadmap por fases" lá para registrar a reordenação.

## 1. Objetivo

Lucas hoje controla estoque em três abas de uma planilha Excel (Entradas,
Saídas, Cadastro/Estoque atual). Ele quer abandonar a planilha e usar o
aplicativo para as mesmas três operações: consultar quanto tem de cada item,
lançar entrada de mercadoria, e dar baixa quando vende. Rodando só nesta
máquina por enquanto (deploy no Railway é outra frente, issue #4, fora deste
escopo).

## 2. Fora de escopo (decisão do Lucas)

- Conexão/sincronização com a Nuvemshop.
- Alerta de estoque baixo / estoque mínimo configurável (a coluna existe na
  planilha antiga mas nunca foi usada — 0 dos itens ativos tem valor).
- Importar os itens da planilha com estoque zerado (histórico/descontinuado).
- Importar o histórico de movimentações da planilha (~243 entradas + ~245
  saídas registradas ao longo dos anos).
- Tela de "importar planilha" dentro do aplicativo — a importação dos dados
  atuais é feita uma vez, por script, fora da interface.
- Múltiplas localizações de estoque (a tabela já existe no schema; o produto
  usa sempre a localização `isDefault` do tenant, sem escolha na tela).
- Precificação/preço de venda como campo obrigatório — fica disponível no
  schema para o futuro (Fase 2), mas o formulário de novo produto não pede.
- Pedidos, vendas com cliente/nota, PDV — "dar baixa" é só o número que saiu,
  sem se transformar num módulo de vendas.

## 3. Risco aceito (decisão do Lucas)

A suíte de testes (`npm test -w api`) roda contra o mesmo banco Postgres de
desenvolvimento e **trunca as tabelas de negócio** — é assim desde antes desta
spec (issue #3 em aberto, banco de teste dedicado nunca foi feito). A partir do
momento em que os itens reais forem importados, rodar a suíte apaga esses
dados junto.

Decisão do Lucas: aceitar o risco por agora, não abrir uma frente nova pra
isso. **Regra operacional para o sênior (e para qualquer sessão futura):**
depois de rodar `npm test -w api` neste banco, reimportar os dados reais
(rodar de novo o script da seção 6) antes de considerar o ambiente
utilizável — nunca devolver acesso ao Lucas com o banco só com dados de teste.

## 4. Modelo de dados

**Nenhuma migração nova.** O schema já suporta tudo:

- `Product` (nome, status) + `Variant` (SKU opcional, preço/custo opcionais) —
  para este v1, **1 produto = 1 variante** por item (a planilha do Lucas não
  agrupa tamanho/cor sob um produto-pai: cada tamanho já é uma linha própria,
  ex. "Vestido Adriana marrom P" e "...G" são dois códigos diferentes). Manter
  esse mapeamento 1:1 evita parsing de texto para separar nome+tamanho, que
  seria frágil e não foi pedido.
- `Location` — usar sempre a que tem `isDefault = true` no tenant. Se não
  existir (não deveria acontecer, o seed sempre cria uma), falhar alto com erro
  claro — nunca criar uma localização "fantasma" silenciosamente.
- `InventoryLevel` — saldo atual, já mantido por `recomputeStock()`. Uma
  variante recém-criada, sem nenhuma movimentação ainda, não tem linha em
  `InventoryLevel` — em `GET /api/products`, trate a ausência de linha como
  estoque `0`, não como erro (o fluxo de lançamento da seção 5.3 cria a linha
  antes de precisar lê-la, então lá a ausência nunca chega a acontecer).
- `StockMovement` — ledger. `recordMovement()` (já existe em
  `inventory.service.ts`) SEMPRE abre sua própria transação via `withTenant`
  — hoje não há como chamá-la de dentro de outra transação já aberta. Isso
  precisa mudar para viabilizar a seção 5.3 (ver instrução técnica ali):
  `recordMovement()` ganha um parâmetro `tx?: TenantTransaction` opcional —
  quando fornecido, usa esse `tx` em vez de abrir `withTenant` de novo; quando
  ausente, comportamento igual ao atual. Os chamadores existentes
  (`prisma/seed.ts`, testes) continuam funcionando sem alteração.

## 5. Regras de negócio

### 5.1 Três tipos de lançamento, mapeados para o ledger existente

| Ação na tela | Usuário digita | `MovementType` | Sinal gravado |
|---|---|---|---|
| Entrada | quantidade que chegou (> 0) | `PURCHASE_ENTRY` | `+quantidade` |
| Saída | quantidade que saiu (> 0) | `SALE` | `-quantidade` |
| Ajuste | **a contagem física total** (≥ 0), não a diferença | `ADJUSTMENT` | `contagem - saldo_atual` |

Para Ajuste: o usuário não sabe nem deve calcular a diferença — ele digita o
número que contou fisicamente. O backend calcula `delta = contagem informada -
saldo atual` e grava esse delta como a movimentação. Se `delta === 0` (a
contagem já bate), não gravar movimentação nenhuma — responder com sucesso e a
mensagem "Estoque já está correto", sem criar ruído no ledger.

`source` de todo lançamento feito pela tela: `APP`.

### 5.2 Observação livre

Todo lançamento aceita um campo de observação opcional (texto livre) — usa o
campo `reason` que já existe em `StockMovement`. É onde o Lucas registra
fornecedor ou qualquer outra nota, do jeito que ele já faz na planilha.

### 5.3 Estoque não pode ficar negativo

Antes de gravar uma Saída ou um Ajuste que resulte em delta negativo, validar
dentro da MESMA transação que `saldo_atual + delta >= 0`. Se violar, **não**
gravar nada e responder erro claro: `"Só há {saldo_atual} em estoque."` (status
400). Essa validação é decisão do Lucas (feita em brainstorming) — não é
negociável nem "melhoria" do implementador.

A checagem tem que ler o saldo e gravar a movimentação na mesma transação, para
não abrir uma janela de corrida entre o casal lançando ao mesmo tempo em
dispositivos diferentes. **Ler o saldo com `SELECT` comum, sem travar a linha,
NÃO basta** — o banco roda em `READ COMMITTED` (padrão do Postgres, `withTenant`
não muda isso) e duas transações lendo o mesmo saldo ao mesmo tempo passam as
duas na validação antes de qualquer uma escrever. É preciso travar a linha
explicitamente.

**O fluxo abaixo vale para os TRÊS tipos de lançamento (entrada, saída,
ajuste), não só para saída/ajuste.** Decisão técnica do sênior, não do Lucas,
mas necessária pra a garantia de saldo correto valer de verdade: sem o lock,
duas Entradas simultâneas no mesmo item também correm risco de se
sobrescrever (lost update) — `recomputeStock()` recalcula o agregado e grava
com um `stock` já resolvido em JavaScript, não com uma expressão atômica no
banco, então a segunda escrita pode pisar na primeira mesmo sem violar saldo
nenhum. Entrada nunca aciona o passo 4 abaixo (quantidade sempre soma), mas
passa pelo mesmo lock.

Fluxo concreto, dentro de `withTenant(tenantId, async (tx) => {...})` (usa o
`tx?` novo de `recordMovement()`, seção 4), NESTA ordem:

1. `tx.inventoryLevel.upsert({ where: { variantId_locationId: {...} }, create: { tenantId, variantId, locationId, stock: 0 }, update: {} })`
   — garante que a linha existe (idempotente: `upsert` do Prisma vira
   `INSERT ... ON CONFLICT`, atômico mesmo sob concorrência, seguro chamar
   duas vezes ao mesmo tempo para o mesmo item novo).
2. `tx.$queryRaw` lendo o `stock` dessa linha com **`SELECT ... FOR UPDATE`**
   (SQL bruto — o Prisma Client não expõe `FOR UPDATE` na API normal). Isso
   trava a linha até o fim da transação: uma segunda transação que tente o
   mesmo passo 1 ou 2 para o MESMO item espera aqui até a primeira terminar
   (commit ou rollback) — é isso que fecha a corrida.
3. Calcular a quantidade a gravar (seção 5.1) usando esse saldo travado.
4. **Se for Ajuste e a quantidade calculada for exatamente 0** (a contagem já
   bate com o saldo travado): não chamar `recordMovement`, parar aqui — a
   transação termina (commit vazio, nada foi escrito) e a rota responde
   sucesso com "Estoque já está correto" (regra de 5.1). **Senão, se o
   resultado violar saldo negativo**: lançar erro e deixar a transação dar
   rollback (a linha destrava sozinha, nada foi escrito).
5. Senão (Entrada sempre, ou Saída/Ajuste que não violam saldo e não são
   delta-zero), chamar `recordMovement(tenantId, { ... }, tx)` passando esse
   mesmo `tx` — nunca abrir uma segunda transação por fora. `recordMovement`
   grava o movimento e recalcula o agregado; como a linha já está travada por
   este `tx` desde o passo 2, esse recálculo também fica serializado.

**Teste automatizado obrigatório** para esta seção (não é opcional, é a regra
mais sensível da spec): um teste que prove o bloqueio de saldo negativo; um
teste que prove que Ajuste com contagem igual ao saldo atual não grava
movimento nenhum; um teste de concorrência com saldo baixo — duas chamadas
disparadas em paralelo (`Promise.all`, não sequenciais disfarçadas), provando
que juntas elas não deixam o saldo final abaixo de zero e que só uma das duas
quantidades é aplicada; e um teste de concorrência com duas Entradas
simultâneas no mesmo item, provando que o saldo final é a soma exata das duas
(`saldo_final = saldo_inicial + quantidadeA + quantidadeB`, nenhuma se perde)
— é o teste que prova, de fato, que estender o lock para Entrada (e não só
Saída/Ajuste) resolve o problema descrito acima, e não só documenta a
intenção.

### 5.4 Cadastro de novo produto

Campos: nome (obrigatório, texto livre), SKU (opcional, texto livre). Sem
preço/custo no formulário (ver seção 2). Produto novo nasce com variante única
e saldo 0 — se o Lucas já tem itens em mãos, ele cadastra e em seguida lança
uma Entrada (mesmo fluxo de sempre, sem campo especial de "estoque inicial").

## 6. Migração dos dados atuais (executar uma vez, fora da interface)

Script novo em `apps/api/scripts/`, no padrão de `prisma/seed.ts` (roda com
`adminPrisma`, bypassa RLS, é uma ferramenta operacional, não parte do
runtime da aplicação). Recebe o caminho do arquivo `.xlsx` por argumento de
linha de comando (não fixar o nome do arquivo do Lucas no código).

Comportamento:
1. Ler a aba `EstoqueAtual-e-Cadastro` do arquivo indicado.
2. Filtrar as linhas com "Estoque atual" > 0 (123 hoje — a contagem de "66"
   estimada no brainstorming original era baseada só nas linhas com "Código"
   preenchido; a planilha real tem mais 57 itens de estoque com nome,
   fornecedor e quantidade preenchidos mas sem código. Decisão do Lucas,
   confirmada depois da spec fechada: importar todo item com estoque > 0,
   tenha código ou não — o código da planilha não entra no sistema de
   qualquer forma, ver item 4 abaixo).
3. **Truncar** as mesmas tabelas que `prisma/seed.ts` trunca (negócio + auth) e
   recriar do zero: tenant "Loja do Casal", os 2 usuários OWNER (mesmas
   variáveis de ambiente `SEED_OWNER1_EMAIL`/`SEED_OWNER2_EMAIL`/
   `SEED_OWNER_PASSWORD` do `.env` — login não muda), 1 localização default.
   Isso substitui os produtos de exemplo do seed pelos produtos reais — não
   fica um "Vestido Floral" fake misturado com o estoque de verdade.
4. Para cada linha filtrada: criar `Product` (nome = "Descreva o Produto") +
   `Variant` única (sem SKU — o "Código" da planilha tem duplicata entre itens
   diferentes, ex. código 761 aparece em duas linhas distintas; não é
   confiável como identificador e não é importado). Gravar uma
   `StockMovement` tipo `ADJUSTMENT`, fonte `INITIAL_SYNC`, quantidade = valor
   de "Estoque atual", motivo "Importação da planilha Excel (data de hoje)", e
   o `InventoryLevel` correspondente — **escrita direta via `adminPrisma`**,
   no mesmo padrão de `seedMovements()` em `prisma/seed.ts` (insert do
   movimento + upsert do nível de estoque), **não** chamando
   `recordMovement()`/`withTenant` — o script já roda fora de RLS
   (`adminPrisma`), então o caminho tenant-scoped não se aplica aqui.
5. Imprimir um resumo no final (quantos produtos criados, soma de estoque) —
   mesmo padrão de log do `prisma/seed.ts`.

Rodar este script é responsabilidade do sênior (execução manual, uma vez,
nesta sessão ou na próxima), não uma rota da aplicação.

## 7. API (nova, não mexe em `/api/me*`)

`/api/me` e `/api/me/products` continuam existindo como estão (há teste de
sessão que depende de `/api/me/products`) — não editar `me.route.ts`. As rotas
de negócio de verdade entram em arquivo novo.

Novo arquivo `apps/api/src/routes/products.route.ts`, montado em
`/api/products`, atrás de `requireAuth` (mesmo padrão de `me.route.ts`:
`req.tenantId`, `req.db`):

- `GET /api/products?q=<busca opcional>` — lista achatada (1 linha por
  variante/item, já que é 1:1), campos: `variantId`, `productId`, `name`,
  `sku`, `stock`. Busca por nome, case-insensitive, `contains`.
- `POST /api/products` — cria produto+variante (corpo: `{ name, sku? }`).
  Retorna o item criado com `stock: 0`. SKU é único por loja
  (`@@unique([tenantId, sku])` no schema); se o SKU informado já existir,
  responder 400 com "Esse código já está sendo usado por outro produto." — não
  deixar cair no erro genérico 500. Capturar isso pelo erro de constraint
  única do Prisma (`P2002`) na escrita, não só por um `SELECT` prévio — dois
  cadastros com o mesmo SKU ao mesmo tempo não podem escapar como 500 (aqui o
  próprio banco já impede o dado duplicado; é só a mensagem de erro que
  precisa ficar amigável mesmo sob corrida).
- `POST /api/products/:variantId/movements` — corpo:
  `{ kind: "entrada" | "saida" | "ajuste", quantity: number, note?: string }`.
  `quantity` é sempre um número ≥ 0 tal como o usuário digitou (positivo para
  entrada/saída, a contagem total para ajuste — nunca um delta já calculado
  pelo front). O backend aplica a regra da seção 5.1. Erros de validação
  (estoque insuficiente, variante de outro tenant, quantidade inválida)
  respondem 400 com mensagem em português, não caem no handler genérico 500.

Lógica de negócio (sinal, cálculo de delta do ajuste, checagem de saldo
negativo) fica em `inventory.service.ts`, não na rota — a rota só valida forma
do corpo (Zod, como o resto do projeto) e chama o service.

**Teste automatizado obrigatório** (além do já pedido em 5.3): cobrir o
cálculo do delta do Ajuste (contagem informada vira a movimentação certa, e
contagem igual ao saldo atual não grava nada), e isolamento de tenant nas três
rotas novas (uma loja não lista, não cria produto em, nem lança movimentação
na variante de outra loja).

## 8. Web

A tela de estoque substitui o placeholder atual em `/dashboard`
("Estoque — em construção.") — não cria uma rota nova separada; é a primeira
coisa que o casal vê ao logar, que é o objetivo. Mantém o cabeçalho com
usuário/logout que já existe ali.

Conteúdo:
- Lista dos itens (nome, SKU se houver, estoque atual), busca por nome acima
  da lista.
- Por item, ação "Registrar movimentação": abre um formulário simples com
  seletor Entrada/Saída/Ajuste, campo de quantidade (rotulado de forma
  diferente para Ajuste: "quantidade contada", não "quantidade"), observação
  opcional.
- Ação separada "Novo produto": nome + SKU opcional.
- Mensagens de erro do backend (estoque insuficiente, nome vazio, etc.)
  aparecem visíveis na tela, em português — nunca falha silenciosa.
- Mobile-first, Tailwind, no padrão visual das telas de auth já existentes.
  Sem componente de design novo.

## 9. Como o Lucas valida

1. Abrir `http://localhost:3000`, logar com `owner1@example.com` /
   `DevSenha!123` (a senha real do seed continua igual).
2. A tela que abre já é a de estoque, com os produtos reais da planilha (os
   que tinham quantidade), não mais os produtos de exemplo.
3. Buscar por um nome parcial (ex. "vestido") e ver a lista filtrar.
4. Abrir um item, registrar uma Entrada de 2 unidades, ver o número subir na
   lista.
5. Registrar uma Saída maior do que o estoque atual do item e ver a tela
   recusar com uma mensagem clara, sem deixar o número ficar negativo.
6. Registrar um Ajuste digitando a contagem física de um item e ver o número
   da lista virar exatamente esse valor.
7. Cadastrar um "Novo produto" pelo nome, ver ele aparecer na lista com
   estoque 0, lançar uma Entrada nele e ver o estoque aparecer.

## 10. Fora desta spec, decisões futuras já sinalizadas

- Deploy Railway (issue #4) — acesso fora desta máquina.
- Nuvemshop (issue #12) — quando entrar, reconciliar com os produtos criados
  manualmente (o schema já tem `nuvemshopProductId`/`nuvemshopVariantId`
  nullable pensando nisso).
- Estoque mínimo / alerta visual (issue nova a abrir, ou parte da #10 do
  PROJETO.md).
- Banco de teste dedicado (issue #3) — risco aceito na seção 3.
