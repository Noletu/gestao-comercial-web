# Interface de estoque — Parte 1 (tela nova, situação e categoria)

Referência visual: `c:\Users\Lucas\Desktop\Referencia.PNG` (fornecida pelo Lucas).
Decisões travadas com ele antes desta spec — ver §2.

## 1. Objetivo

A tela de estoque hoje é funcional e feia: fundo branco, tabela crua, formulários
empilhados, tudo num arquivo só de 746 linhas. O Lucas quer uma interface escura,
minimalista e densa, no espírito da referência, **com tudo funcionando de ponta a
ponta** — e nesta etapa o foco é exclusivamente a gestão de estoque.

Esta é a Parte 1 de duas. A Parte 2 (fornecedor, preço à vista/a prazo) só começa
depois que o Lucas usar esta e opinar.

## 2. Decisões já tomadas pelo Lucas (não reabrir)

| Assunto | Decisão |
|---|---|
| Menu lateral | Só o que funciona: Estoque e Sair. Nada de item decorativo. |
| Tema | Escuro, como a referência. Um visual só. |
| Excluir produto | **Não existe.** Inativar, nunca apagar. |
| Nesta Parte 1 | Situação (ativo/inativo) + categoria |
| Na Parte 2 | Fornecedor + preço à vista/a prazo (desconto único ajustável) |
| Categoria | Lista própria que o Lucas gerencia, não texto livre |

## 3. Fora de escopo desta parte

- Fornecedor, preço à vista/a prazo, desconto global: Parte 2.
- Dashboard, Vendas, Viagens, Relatórios da referência: não existem e não entram.
- Histórico de movimentações em tela: o dado já é gravado em `stock_movement`,
  mas a tela de histórico fica para depois.
- Multi-localização de estoque, Nuvemshop (issue #12), deploy (issue #4).
- Tema claro e alternância de tema.

## 4. Plano de design

Não é "um tema escuro genérico". A referência define a direção; as escolhas abaixo
a seguem e apertam onde ela é frouxa.

### 4.1 Cor

Tokens em `apps/web/app/globals.css` como CSS custom properties, expostos ao
Tailwind por `tailwind.config.ts`. Nada de hex solto no meio do componente.

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#131017` | Fundo da aplicação (grafite levemente quente, não preto puro) |
| `--surface` | `#1B1721` | Sidebar, cabeçalho de tabela, modais |
| `--surface-raised` | `#231E2B` | Linha da tabela sob o cursor, campos de formulário |
| `--border` | `#2E2837` | Divisórias e contornos |
| `--text` | `#EDE9F1` | Texto principal |
| `--text-muted` | `#9A93A6` | Rótulos, texto secundário |
| `--accent` | `#E8368F` | Ação principal, item ativo do menu, marca (magenta da referência) |
| `--ok` / `--warn` / `--danger` | `#3FB37F` / `#E0A33B` / `#E05B5B` | Estados de estoque e situação |

Cada estado de badge usa cor de texto + fundo a 12% de opacidade da própria cor —
nunca um bloco saturado, que numa tabela densa vira ruído.

### 4.2 Tipografia

Uma família só: a pilha de fontes do sistema (`ui-sans-serif, system-ui, "Segoe UI",
…`). **Decisão técnica, não estética:** fonte do Google via `next/font` exige
download em tempo de build, e este projeto precisa buildar sem depender de rede.

- Números de preço, custo, margem e estoque usam `font-variant-numeric: tabular-nums`.
  Numa tabela de conferência, dígito que não alinha é erro de leitura.
- Escala: 12 / 13 / 14 / 18 / 24px. Peso 600 para cabeçalho de coluna e nome do
  produto; 400 para o resto.
- Nada de rótulo em caixa alta espaçada, nada de eyebrow decorativo.

### 4.3 Layout

```
┌──────────────┬───────────────────────────────────────────────────┐
│ Gestão       │  Estoque                            Lucas  [Sair] │
│ Comercial    │  124 peças · 155 unidades                         │
│              ├───────────────────────────────────────────────────┤
│ ▸ Estoque    │  [ Buscar por nome ou código      ] [Filtros] [+] │
│              │  ⚠ 3 peças com estoque baixo (2 ou menos)         │
│              │  ┌─────────────────────────────────────────────┐  │
│              │  │ PEÇA        CÓDIGO   PREÇOS  ESTOQUE  ...   │  │
│              │  │ Calça jeans CAL0003  R$ 115  ③ Baixo  ...   │  │
│              │  └─────────────────────────────────────────────┘  │
│ [Sair]       │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

- Sidebar fixa de 232px; some abaixo de 768px, virando barra superior.
- Conteúdo alinhado à esquerda, largura máxima de 1440px.
- Abaixo de 768px a tabela vira lista de cartões — uma tabela de 8 colunas no
  celular é ilegível, e o Lucas confere estoque de pé, com o celular na mão.
- Ações por linha são ícones com rótulo acessível (`aria-label`): movimentar,
  editar, inativar/reativar. **Sem lixeira.**

### 4.4 Princípios

- A tabela é a heroína. Tudo em volta é quieto para ela respirar.
- Um só acento (magenta), reservado à ação principal e ao item ativo do menu.
- Movimento só para responder a uma ação (abrir modal, salvar). Nada de animação
  de entrada em cada bloco.
- Estado vazio e erro são direção, não desculpa: dizem o que aconteceu e qual é o
  próximo passo.

## 5. Backend

### 5.1 Categoria (tabela nova)

```prisma
model Category {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  products Product[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("category")
}
```

`Product` ganha `categoryId String? @map("category_id") @db.Uuid` e a relação.
Nulo = "Sem categoria", que é um estado legítimo e aparece na tela como "—".

**A migration é área sensível (RLS).** A tabela `category` precisa de:

```sql
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "category"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

Mesmo padrão literal das tabelas existentes na migration inicial. Sem isso, a
categoria de uma loja vaza para outra — e o `CLAUDE.md` exige um teste que prove
o isolamento, não confiança no RLS.

### 5.2 Situação do produto

`Product.status` já existe (`ACTIVE | ARCHIVED | DRAFT`). Nesta etapa usamos
`ACTIVE` e `ARCHIVED` apenas; `DRAFT` fica inalterado e sem uso.

- Inativar = `status: ARCHIVED`. Reativar = `status: ACTIVE`.
- Nenhuma linha é apagada, nenhum histórico se perde.
- Produto inativo **não conta** no total de peças nem no alerta de estoque baixo,
  e não aparece na lista a menos que o filtro peça.

### 5.3 API

| Rota | Muda o quê |
|---|---|
| `GET /api/products` | Novos filtros opcionais: `status` (`ativos` \| `inativos` \| `todos`, padrão `ativos`) e `categoryId` (uuid, ou `sem-categoria`). Cada item do retorno ganha `status` e `category: { id, name } \| null` |
| `PATCH /api/products/:variantId` | Aceita `categoryId` (uuid, `null` limpa) e `status` (`ativo` \| `inativo`) |
| `POST /api/products` | Aceita `categoryId` opcional |
| `GET /api/categories` | Novo. Lista as categorias da loja em ordem alfabética, com a contagem de peças de cada uma |
| `POST /api/categories` | Novo. Cria categoria. Nome repetido (ignorando maiúsculas e espaços nas pontas) responde 400 com mensagem clara, nunca 500 |
| `PATCH /api/categories/:id` | Novo. Renomeia. Mesma regra de nome repetido |

Sem `DELETE` em lugar nenhum. Validação com Zod, no mesmo padrão das rotas atuais.
Erro de validação nunca cai no 500 genérico.

### 5.4 Testes exigidos

Em `apps/api/src/routes/__tests__/` (a suíte roda contra o banco de teste agora):

1. Categoria de uma loja nunca aparece, é editada ou é vinculada por outra loja.
2. Nome de categoria repetido responde 400 com mensagem amigável — inclusive sob
   corrida (duas criações simultâneas), como já se faz para SKU duplicado.
3. `GET /api/products` sem filtro não traz produto inativo; com `status=todos`,
   traz; com `status=inativos`, só inativo.
4. Inativar e reativar não altera estoque nem apaga movimentação.
5. Filtro por categoria retorna só as peças daquela categoria; `sem-categoria`
   retorna as sem vínculo.
6. O alerta de estoque baixo e a contagem de peças ignoram produto inativo.

## 6. Frontend

### 6.1 Estrutura de arquivos

Hoje tudo vive em `apps/web/app/dashboard/page.tsx` (746 linhas). A entrega quebra
isso em componentes, sem mudar a rota:

```
apps/web/app/dashboard/page.tsx      (a tela, bem menor: estado + composição)
apps/web/components/app-shell.tsx    (sidebar + topo)
apps/web/components/product-table.tsx
apps/web/components/product-row.tsx
apps/web/components/filters-bar.tsx
apps/web/components/category-manager.tsx
apps/web/components/modal.tsx
apps/web/components/badge.tsx
apps/web/lib/api.ts                  (fetch + tratamento de erro, hoje duplicado)
apps/web/lib/format.ts               (moeda, percentual, "—")
```

**Sobre a regra de não apagar arquivo:** `page.tsx` é rastreado pelo git e está
commitado; reescrever seu conteúdo é a entrega, não uma remoção, e qualquer versão
anterior volta pelo histórico. A proibição vale integralmente para arquivos **não
rastreados** e para remoção de arquivos — nenhum arquivo pode ser deletado ou
movido nesta tarefa.

As funções já existentes e testadas em produção — `formatCurrency`,
`formatPercent`, `parseOptionalNonNegativeNumber`, `extractErrorMessage`,
`stockStatus` — são **movidas, não reescritas**. O comportamento de `null` virando
"—" é regra de negócio conquistada em spec anterior e não se perde.

### 6.2 Comportamento da tela

- **Cabeçalho:** "Estoque", com a contagem viva de peças e unidades (só ativas).
- **Busca:** um campo só, procura em nome e código ao mesmo tempo, como hoje.
- **Filtros:** estoque baixo (já existe), situação (ativos / inativos / todos) e
  categoria. Filtro ativo aparece como marcador removível, para nunca haver lista
  filtrada sem o usuário perceber por quê.
- **Banner de estoque baixo:** como na referência, com a contagem, e clicável —
  clicar aplica o filtro de estoque baixo.
- **Linha da peça:** nome, categoria, código, preço/custo, margem, estoque com
  badge, situação, e as ações.
- **Ações:** movimentar estoque, editar, inativar (ou reativar).
- **Inativar** pede confirmação explicando que a peça sai da lista mas continua
  guardada, e que dá para reativar. É a única confirmação da tela — confirmação em
  tudo ensina o usuário a clicar em "sim" sem ler.
- **Gerenciar categorias:** painel próprio, aberto por um botão na barra de
  filtros. Cria e renomeia. Não exclui.
- **Estado vazio:** sem nenhuma peça, convida a cadastrar a primeira. Com filtro
  que não casa nada, diz que nenhuma peça casa com o filtro e oferece limpar.
- **Erro:** toda falha aparece na tela em português, em linguagem de
  não-programador. Falha silenciosa é proibida: nenhuma operação pode falhar
  enquanto a tela mostra sucesso.

### 6.3 Qualidade não negociável

- Foco de teclado visível em todo elemento interativo; modal fecha no `Esc` e
  devolve o foco ao botão que a abriu.
- Todo ícone de ação tem rótulo acessível.
- Contraste mínimo 4.5:1 para texto — conferir os tokens, não presumir.
- `prefers-reduced-motion` respeitado.
- Funciona em 400px de largura sem rolagem horizontal da página.

## 7. Como o Lucas valida

Com a aplicação rodando, em `http://localhost:3000`:

1. Entre. A tela agora é escura, com o menu à esquerda mostrando só Estoque e Sair.
   Suas 124 peças aparecem numa tabela, com 155 unidades somadas no topo.
2. Busque por um código. Só aquela peça fica na lista. Limpe a busca.
3. Clique em "Gerenciar categorias", crie "Calça" e "Camisa". Tente criar "calça"
   de novo: tem que recusar com mensagem clara, sem travar.
4. Edite uma peça e escolha a categoria "Calça". A categoria aparece na linha.
5. Filtre por categoria "Calça": só as peças dessa categoria. Filtre por "Sem
   categoria": as demais.
6. Clique no aviso amarelo de estoque baixo no topo: a lista passa a mostrar só as
   peças com 2 unidades ou menos.
7. Inative uma peça. Ela some da lista, o total de peças cai em um, e a mensagem
   deixa claro que ela foi guardada, não apagada.
8. Mude o filtro de situação para "Inativos": a peça está lá. Reative. Ela volta à
   lista e o total sobe de novo.
9. Lance uma entrada de estoque numa peça e veja o número mudar na hora.
10. Abra a mesma tela no celular (ou estreite a janela do navegador): a lista vira
    cartões, ainda dá para buscar, filtrar e movimentar, e nada fica cortado.
11. **Caso de erro:** edite uma peça e coloque o código de outra peça existente. A
    tela recusa com mensagem clara, sem travar e sem perder o que você digitou.

## 8. Critério de aceite

- Tudo do §7 funciona na aplicação rodando de verdade.
- `npm test -w api` verde, com os testes novos do §5.4.
- `npm run typecheck` e `npm run lint` verdes.
- Nenhuma peça do estoque real do Lucas alterada ou perdida pela migration
  (medida antes e depois: 124 peças, 155 unidades).
- Nenhuma rota de exclusão existe no backend.
