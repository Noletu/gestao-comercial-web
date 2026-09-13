// Carrega apps/api/.env.test — NUNCA o .env de desenvolvimento — antes de
// qualquer módulo instanciar o PrismaClient ou ler a chave de cripto, e trava
// a suíte se o alvo não for claramente um banco de teste.
//
// Por quê: ver specs/banco-de-teste-dedicado.md. A suíte trunca tabelas de
// negócio; sem esta trava, qualquer falha no carregamento do env (arquivo
// ausente, variável faltando, alguém rodando de outro diretório) faria a
// suíte cair silenciosamente no banco de desenvolvimento e apagar o estoque
// real do Lucas. Falhar alto aqui é o comportamento correto.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const envTestPath = path.join(apiRoot, ".env.test");

function abort(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (!existsSync(envTestPath)) {
  abort(
    "apps/api/.env.test não existe. A suíte de testes não roda sem um banco " +
      "de teste dedicado, para nunca correr o risco de apagar o estoque " +
      "real. Rode `npm run db:test:setup` (dentro de apps/api) e tente de " +
      "novo.",
  );
}

// override:true garante que .env.test vence qualquer DATABASE_URL/
// DIRECT_DATABASE_URL que já esteja no ambiente (ex.: herdado do shell).
loadEnv({ path: envTestPath, override: true });

function assertPointsToTestDatabase(varName: "DATABASE_URL" | "DIRECT_DATABASE_URL"): void {
  const value = process.env[varName];
  if (!value) {
    abort(
      `A variável ${varName} não está definida em apps/api/.env.test. Rode ` +
        "`npm run db:test:setup` (dentro de apps/api) para gerar o arquivo " +
        "corretamente e tente de novo.",
    );
  }

  let databaseName: string;
  try {
    databaseName = new URL(value).pathname.replace(/^\//, "");
  } catch {
    abort(
      `A variável ${varName} em apps/api/.env.test não é um endereço de ` +
        "banco de dados válido. Rode `npm run db:test:setup` (dentro de " +
        "apps/api) para gerar o arquivo corretamente e tente de novo.",
    );
  }

  if (!databaseName.endsWith("_test")) {
    abort(
      `${varName} em apps/api/.env.test aponta para o banco ` +
        `"${databaseName}", que não termina em "_test". Por segurança, a ` +
        "suíte se recusa a rodar fora de um banco de teste dedicado — isso " +
        "evitaria apagar dados reais do estoque. Confira apps/api/.env.test " +
        "e corrija o endereço, ou rode `npm run db:test:setup` (dentro de " +
        "apps/api) para gerar um novo.",
    );
  }
}

assertPointsToTestDatabase("DATABASE_URL");
assertPointsToTestDatabase("DIRECT_DATABASE_URL");
