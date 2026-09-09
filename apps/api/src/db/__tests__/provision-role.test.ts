import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminPrisma } from "../tenant.js";

/**
 * PROVA NÃO-NEGOCIÁVEL (GATE 1, issue #4): `scripts/provision-db-role.mjs`
 * de fato cria/mantém o role `app_user`, é idempotente de verdade (não só de
 * comentário), e a senha que ele aplica FUNCIONA para autenticar — não basta
 * o script imprimir sucesso. Cobre também o achado MÉDIO (Correção 5): o
 * escaping manual de aspa simples no literal SQL da senha.
 *
 * ATENÇÃO — restrição crítica: este script altera a senha REAL do role
 * `app_user` no Postgres compartilhado por toda a suíte (os outros arquivos
 * de teste conectam como app_user com a senha de `apps/api/.env`). Guardamos
 * a senha original e a restauramos no `afterEach` (que roda de qualquer
 * forma, mesmo se o `it` falhar), com o `afterAll` como rede final. Restaurar
 * a cada teste — e não só no fim do arquivo — encurta para um único `it` a
 * janela em que uma morte abrupta do processo deixaria o banco com senha de
 * teste, quebrando toda execução seguinte da suíte.
 */

const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/provision-db-role.mjs",
);

interface ExecFileError {
  status: number | null;
  stdout: string;
  stderr: string;
}

function isExecFileError(err: unknown): err is ExecFileError {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    "stdout" in err &&
    "stderr" in err
  );
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Roda o script real (`node scripts/provision-db-role.mjs`) num subprocesso,
 * com o ambiente montado explicitamente — assim o caso de env ausente fica
 * testável de verdade pelo código de saída do processo, não por mock.
 */
function runProvisionScript(
  envOverrides: Record<string, string | undefined>,
): RunResult {
  try {
    const stdout = execFileSync("node", [SCRIPT_PATH], {
      env: { ...process.env, ...envOverrides },
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    if (!isExecFileError(err)) throw err;
    return { status: err.status ?? 1, stdout: err.stdout, stderr: err.stderr };
  }
}

/** Monta a DATABASE_URL de app_user com uma senha específica, preservando host/porta/db. */
function appUserUrl(password: string): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL ausente no ambiente de teste.");
  const url = new URL(base);
  url.password = password;
  return url.toString();
}

/** Conecta como app_user com a senha dada e roda um SELECT — prova a senha de verdade. */
async function assertAppUserCanConnect(password: string): Promise<void> {
  const client = new PrismaClient({ datasourceUrl: appUserUrl(password) });
  try {
    const rows = await client.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(rows[0]?.ok).toBe(1);
  } finally {
    await client.$disconnect();
  }
}

// Guardada ANTES de qualquer alteração. Se ausente, nenhum teste roda (ver
// beforeAll) e nada precisa ser restaurado.
const ORIGINAL_APP_USER_PASSWORD = process.env.APP_USER_PASSWORD;

beforeAll(() => {
  if (!ORIGINAL_APP_USER_PASSWORD) {
    throw new Error(
      "APP_USER_PASSWORD ausente no ambiente de teste. Este teste precisa " +
        "dela para restaurar a senha do app_user depois de alterá-la — " +
        "configure apps/api/.env antes de rodar a suíte.",
    );
  }
});

/**
 * Devolve o `app_user` à senha real do ambiente. Roda depois de CADA teste, não
 * só no fim do arquivo: assim a janela em que o banco fica com senha de teste é
 * um `it`, não o arquivo inteiro. Importa porque o `afterAll` sozinho não cobre
 * o processo do vitest morrer no meio (kill, OOM, queda de energia) — nesse
 * cenário a senha ficaria travada num valor de teste e TODA execução seguinte
 * da suíte falharia por autenticação, com diagnóstico confuso.
 */
function restoreOriginalPassword(): void {
  // Só restaura se de fato tínhamos uma senha original para voltar (o beforeAll
  // já barrou a suíte se não tinha — aqui é defesa extra, não dependemos de os
  // testes terem passado).
  if (!ORIGINAL_APP_USER_PASSWORD) return;
  const restore = runProvisionScript({
    APP_USER_PASSWORD: ORIGINAL_APP_USER_PASSWORD,
  });
  if (restore.status !== 0) {
    throw new Error(
      `Falha ao restaurar a senha original do app_user após o teste ` +
        `(a suíte inteira pode estar com o banco na senha errada a ` +
        `partir daqui): ${restore.stderr}`,
    );
  }
}

// Roda mesmo quando o `it` falha. Reaplicar a senha já correta é inofensivo e
// barato — é exatamente a idempotência que este arquivo prova.
afterEach(() => {
  restoreOriginalPassword();
});

afterAll(async () => {
  try {
    // Rede final: se o último afterEach tiver falhado, ainda tentamos voltar ao
    // estado bom antes de encerrar o arquivo.
    restoreOriginalPassword();
  } finally {
    await adminPrisma.$disconnect();
  }
});

describe("provision-db-role.mjs — GATE 1 (issue #4)", () => {
  it("cria/mantém o role app_user com LOGIN", async () => {
    const result = runProvisionScript({
      APP_USER_PASSWORD: ORIGINAL_APP_USER_PASSWORD,
    });
    expect(result.status).toBe(0);

    // Verificação via pg_roles (em vez de derrubar o role primeiro): o role
    // já nasce pela migration com GRANTs que impedem DROP ROLE direto num
    // banco compartilhado. O script é idempotente por desenho — rodá-lo
    // sobre um role já existente e confirmar LOGIN prova o mesmo contrato
    // ("o role existe com LOGIN depois de rodar o script").
    const rows = await adminPrisma.$queryRaw<
      { rolcanlogin: boolean }[]
    >`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'app_user'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolcanlogin).toBe(true);
  });

  it("é idempotente: rodar duas vezes seguidas termina em sucesso nas duas, sem efeito duplicado", async () => {
    const first = runProvisionScript({
      APP_USER_PASSWORD: ORIGINAL_APP_USER_PASSWORD,
    });
    const second = runProvisionScript({
      APP_USER_PASSWORD: ORIGINAL_APP_USER_PASSWORD,
    });
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);

    const rows = await adminPrisma.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM pg_roles WHERE rolname = 'app_user'`;
    expect(rows[0]?.count).toBe(1);
  });

  it("a senha aplicada funciona de verdade: conectar como app_user com ela responde a um SELECT", async () => {
    const testPassword = randomBytes(16).toString("hex");
    const result = runProvisionScript({ APP_USER_PASSWORD: testPassword });
    expect(result.status).toBe(0);

    await assertAppUserCanConnect(testPassword);
  });

  it("senha contendo aspa simples é escapada corretamente e a conexão com ela funciona", async () => {
    const testPassword = `it's-a-test-${randomBytes(8).toString("hex")}'`;
    const result = runProvisionScript({ APP_USER_PASSWORD: testPassword });
    expect(result.status).toBe(0);

    await assertAppUserCanConnect(testPassword);
  });

  it("falha ruidosa: sem APP_USER_PASSWORD, o script sai com código diferente de zero e não silencia o erro", () => {
    // String vazia, não `undefined`: o cliente Prisma gerado (importado pelo
    // próprio script) recarrega apps/api/.env no import e PREENCHE qualquer
    // variável AUSENTE do process.env do subprocesso a partir do arquivo —
    // mas não sobrescreve uma que já existe (mesmo vazia). `undefined` some
    // a chave (vira "ausente" para o Prisma, que a repõe do .env real e
    // mascara o caso); "" mantém a chave presente e vazia, disparando o
    // mesmo `if (!password)` do script sem depender do .env do repo.
    const result = runProvisionScript({ APP_USER_PASSWORD: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/APP_USER_PASSWORD/);
  });
});
