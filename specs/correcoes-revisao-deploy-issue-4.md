# Correções da revisão retroativa — issue #4 (deploy Railway)

## Contexto

O código de deploy da issue #4 entrou no `main` sem passar pela revisão do fluxo.
A revisão foi feita retroativamente e voltou com veredito **CORRIGIR ANTES DE
ACEITAR**: nenhum achado crítico, dois ALTOS e dois MÉDIOS. Esta spec fecha os
quatro.

Estado atual do `main` (medido nesta sessão, não presumido): `npm run typecheck`,
`npm run lint`, `npm run build` e `npm test -w api` (27 testes, 7 arquivos) todos
verdes, com Postgres real na porta 5433.

---

## Correção 1 (ALTO) — a senha gerada como o guia manda quebra o boot

### Problema

`DEPLOY.md` (seção "5. Secrets e variáveis") manda gerar `APP_USER_PASSWORD` com
`openssl rand -base64 32` ou o botão **Generate** do Railway, e colar o valor
dentro do template de URL:

```
postgresql://app_user:${{APP_USER_PASSWORD}}@${{Postgres.PGHOST}}:...
```

Base64 usa o alfabeto `A-Za-z0-9+/=`. Uma `/` no campo de senha quebra o parsing
da URL. `DATABASE_URL` é validada com `z.string().url()` em
`apps/api/src/lib/env.ts`, que por baixo usa `new URL()` — e a URL inválida faz
`process.exit(1)` no boot.

**Medido nesta sessão, não estimado:** 48,5% de 20.000 senhas geradas com
`openssl rand -base64 32` contêm `/`. Ou seja, ~1 chance em 2 de o primeiro
deploy travar.

O aviso existente no guia ("Evite `'` na senha do app_user") cobre só o escaping
SQL do script de provisionamento — nunca menciona `/`.

### O que fazer

Em `DEPLOY.md`, na linha que hoje diz:

```
- `BETTER_AUTH_SECRET` e `APP_USER_PASSWORD`: botão **Generate** do Railway (32
  chars) ou `openssl rand -base64 32`. (Evite `'` na senha do app_user.)
```

Separe os dois casos, porque as exigências são diferentes:

- `BETTER_AUTH_SECRET`: pode continuar com `openssl rand -base64 32` ou o botão
  **Generate** do Railway — esse valor não entra em nenhuma URL.
- `APP_USER_PASSWORD`: **precisa ser URL-safe**, porque é interpolado dentro de
  `DATABASE_URL`. Instrua `openssl rand -hex 32` (alfabeto `0-9a-f`, sempre
  seguro em URL). Explique em uma linha o porquê: caracteres `/`, `+`, `=` e `'`
  quebram, respectivamente, o parsing da URL e o literal SQL do provisionamento;
  e avise que o botão **Generate** do Railway **não** serve para esta variável
  específica, porque pode produzir esses caracteres.

Ajuste também a linha da tabela de variáveis onde `APP_USER_PASSWORD` aparece
como _(gere 32 chars)_, para apontar o método correto.

Não invente política de senha nova nem mude nenhum valor de exemplo além disso.

---

## Correção 2 (ALTO, defesa em profundidade) — erro de boot ilegível

### Problema

Se a `DATABASE_URL` for inválida (o cenário da Correção 1, ou qualquer erro de
digitação), o boot aborta imprimindo o `fieldErrors` cru do Zod. Quem opera este
projeto **não é programador e não lê stack trace**. A regra do `CLAUDE.md` é
explícita: erro tem que ser visível em linguagem de não-programador. Hoje o
operador vê `{ DATABASE_URL: [ 'Invalid url' ] }` e não tem como agir.

### O que fazer

Em `apps/api/src/lib/env.ts`, no bloco `if (!parsed.success)`, **mantenha** a
saída atual (o `fieldErrors` continua útil para quem lê log) e **acrescente**
uma dica acionável quando — e somente quando — o campo com erro for
`DATABASE_URL` ou `DIRECT_DATABASE_URL`. A dica deve, em português claro:

1. dizer que o endereço do banco está inválido;
2. apontar a causa mais provável: a senha contém um caractere que quebra o
   endereço (`/`, `+`, `=` ou espaço);
3. dizer o que fazer: gerar a senha com `openssl rand -hex 32` e atualizar
   `APP_USER_PASSWORD` **e** a `DATABASE_URL` que a referencia.

Não mude o comportamento de abortar (`process.exit(1)`) — falha ruidosa no boot
é o desenho correto e deve continuar. Não relaxe nenhuma validação: nada de
trocar `.url()` por regex frouxa para "aceitar" a senha ruim. A senha ruim tem
que continuar falhando; ela só precisa falhar de forma compreensível.

---

## Correção 3 (ALTO) — GATE 1 sem prova automatizada

### Problema

`apps/api/scripts/provision-db-role.mjs` é o GATE 1 inteiro da issue #4 (senha
do `app_user` fora do SQL versionado) e **não tem nenhum teste**. A afirmação
"é idempotente, pode rodar a cada deploy" está sustentada só por comentário no
código. Compare com o GATE 2, que ganhou `rls.pooling.test.ts` provando de fato
o que promete.

### O que fazer

Crie `apps/api/src/db/__tests__/provision-role.test.ts`, seguindo o padrão de
`rls.pooling.test.ts` (Postgres real, sem mock).

Casos obrigatórios:

1. **Cria o role quando ele não existe.** Remova o role de um estado conhecido
   ou verifique via `pg_roles`; após rodar o script, o role `app_user` existe
   com `LOGIN`.
2. **Idempotência real:** rodar o script **duas vezes seguidas** termina com
   sucesso nas duas, sem erro e sem efeito duplicado.
3. **A senha aplicada funciona de verdade:** depois de rodar o script com uma
   senha conhecida, abrir uma conexão nova como `app_user` com essa senha
   conecta e responde a um `SELECT 1`. Este é o caso que prova o gate — não
   basta o script imprimir sucesso.
4. **Senha contendo aspa simples (`'`)** é aplicada corretamente e a conexão com
   ela funciona. Isto cobre o achado MÉDIO do escaping manual: a prova de que
   `replace(/'/g, "''")` faz o que promete.
5. **Falha ruidosa:** sem `APP_USER_PASSWORD` no ambiente, o script sai com
   código diferente de zero e não silencia o erro.

### Restrição crítica deste teste (leia com atenção)

O script **altera a senha do `app_user` no banco compartilhado de testes**. Os
outros 27 testes conectam com a senha que está em `apps/api/.env`. Se este teste
deixar outra senha aplicada, **toda a suíte quebra depois dele** — e o
diagnóstico seria confuso.

Portanto:

- Guarde a senha original (`process.env.APP_USER_PASSWORD`) antes de qualquer
  alteração e **restaure-a no `afterAll`**, rodando o script mais uma vez com o
  valor original — inclusive se algum caso falhar no meio (use `afterAll`, que
  roda de qualquer forma; não dependa de o teste passar).
- Se `APP_USER_PASSWORD` não estiver no ambiente, o teste deve **falhar com
  mensagem clara** dizendo que precisa dela, em vez de rodar pela metade e
  deixar o banco num estado ruim.
- A suíte roda em série (`fileParallelism: false` no `vitest.config.ts`), então
  não há concorrência com outros arquivos — mas não crie dependência de ordem
  entre arquivos.

Para invocar o script, use `execFile`/`execFileSync` de `node:child_process`
chamando `node scripts/provision-db-role.mjs` com o ambiente montado
explicitamente (assim o caso 5, de env ausente, fica testável de verdade — o
código de saída do processo é o que se mede). Resolva o caminho do script a
partir do arquivo de teste, sem depender do diretório de onde o vitest foi
chamado.

---

## Correção 4 (MÉDIO) — o guia descreve errado quando o release roda

### Problema

`DEPLOY.md` afirma "**Migrations e provisionamento rodam no release**, não no
build". `apps/api/railway.json` define apenas `deploy.startCommand`; não há fase
de release separada. Na prática `prisma migrate deploy && node
scripts/provision-db-role.mjs && node dist/index.js` roda **a cada boot do
contêiner** — inclusive em reinício por queda, não só em deploy novo.

Funcionalmente não quebra (o desenho é idempotente de propósito), mas o texto
faz quem opera subestimar a frequência real.

### O que fazer

Corrija a redação para descrever o mecanismo real: o comando de start roda a
cada inicialização do contêiner (deploy novo **e** reinício), e é por isso que
precisa ser idempotente. Mantenha o tom e o formato do documento. **Não** altere
`railway.json` nem troque o mecanismo — a mudança aqui é de texto, para o
documento parar de mentir sobre o código.

---

## Correção 5 (MÉDIO) — escaping manual sem decisão registrada

### Problema

`provision-db-role.mjs` monta o literal SQL da senha com
`password.replace(/'/g, "''")`. Está correto hoje (`standard_conforming_strings=on`,
default do Postgres), e o comentário explica o porquê — mas parece escolha
incidental, não decisão pesada.

### O que fazer

Ajuste o comentário existente para registrar explicitamente que **não existe
alternativa parametrizada**: `ALTER ROLE ... PASSWORD` é DDL e o Postgres não
aceita bind-params em DDL, então o literal escapado é a única via. Cite que o
caso com aspa simples está coberto pelo teste da Correção 3.

Uma frase ou duas. Não reescreva o script nem mude a lógica.

---

## Restrições gerais

- TypeScript strict, sem `any`, sem cast forçado. Convenções do `CLAUDE.md`.
- **Não apague nem mova nenhum arquivo**, por nenhum meio. Não sobrescreva
  arquivo existente com conteúdo novo fora do que esta spec pede.
- Não toque em `.env`, `apps/api/.env`, `apps/web/.env.local`, `.claude/`,
  `.gitignore`, nem em nada que apareça em `git status --porcelain --ignored`.
- Não mexa em `railway.json`, no schema do Prisma, nem em migrations.
- Não altere `HANDOFF.md`.
- Não commite. Eu (sênior) reviso e commito.

## Verificações antes de devolver

Rode e reporte o resultado real (não presuma):

1. `npm run typecheck` na raiz — tem que passar.
2. `npm run lint` na raiz — tem que passar.
3. `npm test -w api` na raiz — **todos** os testes, não só o novo. O número tem
   que ser 27 + os casos novos, com zero falhas. Se a suíte quebrar depois do
   teste novo, é sinal de que a senha não foi restaurada (ver restrição crítica).
4. Rode `npm test -w api` **duas vezes seguidas** e confirme o mesmo resultado —
   prova de que o teste novo não deixa estado sujo para trás.

O Postgres de teste já está de pé na porta 5433. Se precisar, `./scripts/dev-db.ps1
start` (só `start`; **nunca** `reset`, que apaga o cluster).

---

## Como o Lucas valida

O Lucas não lê código. Depois desta mudança, ele consegue conferir assim:

1. **A armadilha do deploy sumiu do guia:** abrir o guia de publicação e
   procurar a parte que ensina a gerar a senha do banco. Antes, ela mandava usar
   um gerador que produz senha com barra quase metade das vezes — e senha com
   barra faz o sistema não subir. Depois, o guia manda um gerador que nunca
   produz caractere problemático, e explica por quê em uma linha.
2. **Se ainda assim a senha estiver errada, a mensagem faz sentido:** ao subir o
   sistema com um endereço de banco inválido, em vez de um despejo técnico
   ilegível, aparece uma mensagem dizendo que o endereço do banco está inválido,
   que a causa provável é a senha ter um caractere que quebra o endereço, e qual
   comando usar para gerar uma senha boa.
3. **A promessa de "publicar quantas vezes quiser sem quebrar" agora é provada,
   não prometida:** rodar a bateria de testes passa a incluir um teste que
   executa o passo de publicação duas vezes seguidas e confirma que continua
   funcionando, inclusive conectando no banco com a senha aplicada.
