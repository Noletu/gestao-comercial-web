# Banco de teste dedicado (issue #3)

## 1. Problema

Hoje `npm test -w api` roda contra o MESMO banco de desenvolvimento onde vive o
estoque real do Lucas (123 produtos, 153 unidades). Os testes de integração
truncam as tabelas de negócio (`truncateAll()` em vários arquivos de teste), então
toda rodada apaga o estoque e exige reimportar a planilha `.xlsx` depois:

```
npm run db:import-inventory -- "../../Planilha (Controle de estoque) - 2025 - Modificado.xlsx"
```

Causa raiz: `apps/api/vitest.setup.ts` faz `import "dotenv/config"`, que carrega
`apps/api/.env` — o env de desenvolvimento. `DATABASE_URL` e `DIRECT_DATABASE_URL`
apontam para o database `gestao_comercial` no cluster da porta 5433. Testes e
aplicação compartilham o mesmo database, e nada impede isso.

## 2. Objetivo

`npm test -w api` nunca mais toca no estoque real. Não deve haver passo manual de
recuperação depois de rodar a suíte.

## 3. Fora de escopo

- `npm run db:seed` e `npm run db:reset` continuam agindo sobre o banco de
  desenvolvimento. São comandos que a pessoa dispara de propósito, sabendo o que
  fazem; a queixa é sobre a suíte de testes, que se roda a toda hora.
- Docker: o fluxo sem Docker (`scripts/dev-db.ps1`, porta 5433) é o que está em
  uso. O caminho Docker (porta 5432) continua funcionando do mesmo jeito, com o
  mesmo arquivo de env de teste apontando para a porta que a pessoa usa.
- Banco de teste em CI / GitHub Actions: não existe pipeline hoje. Quando existir,
  reaproveita o mesmo `db:test:setup`.
- Paralelismo dos testes: continuam em série (`fileParallelism: false`). Um
  database separado por arquivo de teste seria a próxima evolução, não esta.

## 4. Solução

Database separado, **no mesmo cluster Postgres** da porta 5433 que já está de pé.
Nenhuma instalação nova, nenhum serviço novo, nenhum container.

- Database de desenvolvimento: `gestao_comercial` (estoque real do Lucas).
- Database de teste: `gestao_comercial_test` (some e volta a cada rodada, sem dó).

### 4.1 `apps/api/.env.test` (novo, NÃO versionado)

Arquivo de env exclusivo dos testes. `DATABASE_URL` e `DIRECT_DATABASE_URL`
apontam para `gestao_comercial_test`. Demais variáveis (`ENCRYPTION_KEY`,
`BETTER_AUTH_SECRET`, etc.) recebem valores locais de teste — nunca os de
desenvolvimento nem os de produção.

`.gitignore` já ignora `.env.*`. Passa a haver `apps/api/.env.test.example`
versionado, como já existe `.env.example`; para isso o `.gitignore` ganha a
exceção `!.env.*.example`.

### 4.2 `apps/api/vitest.setup.ts` — a trava

Passa a carregar `apps/api/.env.test` com `override: true` e, **antes de qualquer
teste rodar**, valida:

1. O arquivo `.env.test` existe. Se não existir: aborta com mensagem dizendo para
   rodar `npm run db:test:setup`.
2. `DATABASE_URL` e `DIRECT_DATABASE_URL` estão definidos e o nome do database em
   AMBOS termina em `_test`. Se não terminar: aborta.

A trava é o ponto central desta spec, não um detalhe. Sem ela, qualquer falha no
carregamento do env (arquivo ausente, variável faltando, alguém rodando de outro
diretório) faz a suíte cair silenciosamente no banco de desenvolvimento e apagar o
estoque — exatamente o problema que estamos resolvendo. **Falhar alto é o
comportamento correto: a suíte se recusa a rodar em vez de rodar no banco errado.**

A validação roda no `setupFiles`, que o Vitest executa antes da suíte, e usa
`process.exit(1)` com mensagem em português, legível para quem não é programador.

### 4.3 `npm run db:test:setup` (novo script em `apps/api/package.json`)

Idempotente. Preparo de uma vez só, e repetível sem estrago:

1. Cria `apps/api/.env.test` a partir do `.env.test.example` se ainda não existir.
2. Cria o database `gestao_comercial_test` se ainda não existir (conectando ao
   cluster como `postgres`, via `DIRECT_DATABASE_URL` do `.env.test` com o
   database trocado por `postgres`).
3. Aplica o schema (`prisma migrate deploy`) e o SQL de RLS no database de teste.
4. Aplica a senha do `app_user` no cluster (`db:provision-role`) — o role é do
   cluster, já existe; o passo é idempotente e garante que o database novo tem as
   permissões certas.

O script **nunca** age sobre um database cujo nome não termine em `_test` — mesma
trava do item 4.2, pelo mesmo motivo.

### 4.4 Documentação

- `README.md`: seção de banco ganha o passo do banco de teste.
- `CLAUDE.md`: a nota que hoje diz "rodar `npm test -w api` apaga o estoque real
  do Lucas" deixa de ser verdade e passa a descrever o banco de teste e a trava.
  A nota sobre `db:seed` continua valendo.

## 5. Arquivos afetados

| Arquivo | O que muda |
|---|---|
| `apps/api/vitest.setup.ts` | Carrega `.env.test`, valida, aborta se o alvo não for de teste |
| `apps/api/.env.test.example` | Novo, versionado |
| `apps/api/.env.test` | Novo, **não** versionado, criado pelo script |
| `apps/api/scripts/setup-test-db.mjs` | Novo, cria o database e aplica schema |
| `apps/api/package.json` | Novo script `db:test:setup` |
| `.gitignore` | Exceção `!.env.*.example` |
| `README.md`, `CLAUDE.md` | Documentação |

Nenhum arquivo de código do aplicativo (`src/`) muda. Nenhum teste existente muda.
O comportamento do aplicativo é exatamente o mesmo.

## 6. Riscos

- **Risco de apagar o estoque durante a própria implementação.** A implementação
  não pode rodar a suíte contra o banco de desenvolvimento para "testar se
  funciona". A ordem obrigatória é: criar o banco de teste → configurar o
  `.env.test` → só então rodar a suíte. A validação do item 4.2 é escrita e
  conferida ANTES da primeira rodada.
- Se o cluster da porta 5433 não estiver de pé, `db:test:setup` falha com
  mensagem clara mandando rodar `./scripts/dev-db.ps1 start`.

## 7. Como o Lucas valida

1. Confira primeiro que seu estoque está lá: abra `http://localhost:3000`, entre,
   e veja as 123 peças na tela. Anote o número que aparece.
2. Peça para eu rodar a suíte de testes completa.
3. Volte na tela do estoque e recarregue. **As mesmas 123 peças continuam lá.**
   Antes desta mudança, a lista estaria vazia e seria preciso reimportar a
   planilha.
4. Para ver a trava funcionando, peça para eu esconder o arquivo de configuração
   de teste e rodar a suíte de novo: ela deve **recusar** rodar, com uma mensagem
   em português explicando o que fazer — e o seu estoque continua intacto na tela.

## 8. Critério de aceite

- `npm test -w api` roda verde (74/74) contra `gestao_comercial_test`.
- O database `gestao_comercial` fica byte-a-byte intacto depois da suíte.
- Sem `.env.test`, ou com env apontando para database que não termina em `_test`,
  a suíte aborta sem executar um único teste.
