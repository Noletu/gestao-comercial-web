// ─────────────────────────────────────────────────────────────────────────────
// Setup do banco de teste dedicado (issue #3, specs/banco-de-teste-dedicado.md).
//
// Por quê: `npm test -w api` rodava contra o MESMO banco de desenvolvimento
// onde vive o estoque real do Lucas — a suíte trunca tabelas de negócio, então
// toda rodada apagava o estoque e exigia reimportar a planilha. Este script
// cria/prepara um database SEPARADO (mesmo cluster Postgres, nome termina em
// "_test") para a suíte usar, e nunca toca no database de desenvolvimento.
//
// Idempotente — pode rodar quantas vezes quiser:
//  1. Cria apps/api/.env.test a partir de .env.test.example, se ainda não existir.
//  2. Cria o database (ex.: gestao_comercial_test) no cluster, se ainda não existir.
//  3. Aplica o schema + RLS no banco de teste (prisma migrate deploy) — inclui os
//     GRANTs que dão ao app_user acesso às tabelas do database novo.
//  4. Aplica a senha do role app_user (reaproveita scripts/provision-db-role.mjs)
//     SOMENTE SE o role ainda não existir no cluster. O role é do CLUSTER
//     (compartilhado com o database de desenvolvimento) — rodar
//     provision-db-role.mjs quando ele já existe reescreveria a senha do
//     ambiente de dev inteiro a partir do APP_USER_PASSWORD de .env.test.
//     Se o role já existe, este passo é PULADO e a senha dele não é tocada.
//
// Trava de segurança: este script recusa agir sobre qualquer database cujo
// nome não termine em "_test" — mesmo motivo da trava em vitest.setup.ts.
//
// .mjs puro (sem TypeScript/tsx), mesmo precedente de provision-db-role.mjs:
// roda direto com `node`, sem depender de build nem de devDependencies extras.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const envTestPath = path.join(apiRoot, ".env.test");
const envTestExamplePath = path.join(apiRoot, ".env.test.example");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

// 1. Cria apps/api/.env.test a partir do exemplo, se ainda não existir.
if (!existsSync(envTestPath)) {
  if (!existsSync(envTestExamplePath)) {
    fail(
      "apps/api/.env.test.example não encontrado. Este arquivo deveria estar " +
        "versionado no repositório — confira se o clone está completo.",
    );
  }
  copyFileSync(envTestExamplePath, envTestPath);
  console.log("✅ apps/api/.env.test criado a partir de .env.test.example.");
}

// Carrega SÓ o .env.test — nunca o .env de desenvolvimento — e sobrescreve
// qualquer DATABASE_URL/DIRECT_DATABASE_URL que já esteja no ambiente.
loadEnv({ path: envTestPath, override: true });

function requireTestDatabaseUrl(varName) {
  const value = process.env[varName];
  if (!value) {
    fail(
      `A variável ${varName} não está definida em apps/api/.env.test. Apague ` +
        "o arquivo e rode `npm run db:test:setup` de novo para gerar um novo.",
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(
      `${varName} em apps/api/.env.test não é um endereço de banco de dados ` +
        "válido.",
    );
    return; // inalcançável — fail() encerra o processo; ajuda o TypeScript/linters.
  }

  const databaseName = url.pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    fail(
      `${varName} em apps/api/.env.test aponta para o banco "${databaseName}", ` +
        'que não termina em "_test". Por segurança, este script nunca age ' +
        "sobre um database que não seja claramente de teste. Corrija o " +
        "endereço em apps/api/.env.test.",
    );
    return;
  }

  return { url, databaseName };
}

const { databaseName } = requireTestDatabaseUrl("DATABASE_URL");
const { url: directUrl, databaseName: directDatabaseName } =
  requireTestDatabaseUrl("DIRECT_DATABASE_URL");

if (databaseName !== directDatabaseName) {
  fail(
    "DATABASE_URL e DIRECT_DATABASE_URL em apps/api/.env.test apontam para " +
      `databases diferentes ("${databaseName}" e "${directDatabaseName}"). ` +
      "Os dois precisam apontar para o mesmo banco de teste.",
  );
}

// 2. Cria o database de teste, conectando como owner ao database de manutenção
// "postgres" do mesmo cluster (mesmo padrão de scripts/provision-db-role.mjs,
// que também conecta via DIRECT_DATABASE_URL/owner para DDL).
const maintenanceUrl = new URL(directUrl.toString());
maintenanceUrl.pathname = "/postgres";

// Escapa aspas duplas do identificador (nunca haverá numa configuração normal,
// mas evita SQL quebrado em vez de injeção silenciosa).
const escapedDatabaseName = databaseName.replace(/"/g, '""');

function extractPgErrorCode(err) {
  if (err && typeof err === "object" && "meta" in err) {
    const meta = err.meta;
    if (
      meta &&
      typeof meta === "object" &&
      "code" in meta &&
      typeof meta.code === "string"
    ) {
      return meta.code;
    }
  }
  return null;
}

function isConnectionRefused(err) {
  if (err && typeof err === "object" && "code" in err && err.code === "P1001") {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Can't reach database server") ||
    message.includes("ECONNREFUSED")
  );
}

const maintenanceClient = new PrismaClient({
  datasourceUrl: maintenanceUrl.toString(),
});

let createDatabaseError = null;
try {
  await maintenanceClient.$executeRawUnsafe(
    `CREATE DATABASE "${escapedDatabaseName}"`,
  );
  console.log(`✅ Database "${databaseName}" criado.`);
} catch (err) {
  createDatabaseError = err;
}

if (createDatabaseError) {
  // 42P04 = "database already exists" no Postgres — idempotente, segue o fluxo.
  if (extractPgErrorCode(createDatabaseError) === "42P04") {
    console.log(
      `ℹ️  Database "${databaseName}" já existia — seguindo em frente.`,
    );
  } else if (isConnectionRefused(createDatabaseError)) {
    await maintenanceClient.$disconnect();
    fail(
      `Não consegui conectar ao Postgres em ${maintenanceUrl.hostname}:` +
        `${maintenanceUrl.port}. O cluster de desenvolvimento está de pé? ` +
        "Rode `./scripts/dev-db.ps1 start` (a partir da raiz do projeto) e " +
        "tente de novo.",
    );
  } else {
    await maintenanceClient.$disconnect();
    fail(
      `Falha ao criar o database "${databaseName}": ` +
        (createDatabaseError instanceof Error
          ? createDatabaseError.message
          : String(createDatabaseError)),
    );
  }
}

// 2.1. Verifica se o role "app_user" já existe no CLUSTER, antes de decidir
// (no passo 4) se roda provision-db-role.mjs. Reaproveita o maintenanceClient
// enquanto ainda está conectado — desconecta logo depois desta consulta.
// Falha nesta consulta NÃO deve seguir para o ALTER ROLE "na dúvida": o
// comportamento seguro é não mexer na senha, então falha alto aqui também.
let appUserRoleExists;
try {
  const roleRows = await maintenanceClient.$queryRawUnsafe(
    "SELECT 1 FROM pg_roles WHERE rolname = 'app_user'",
  );
  appUserRoleExists = Array.isArray(roleRows) && roleRows.length > 0;
} catch (err) {
  await maintenanceClient.$disconnect();
  fail(
    'Falha ao consultar se o role "app_user" já existe no cluster ' +
      "(pg_roles): " +
      (err instanceof Error ? err.message : String(err)) +
      '. Por segurança, o script não decide "na dúvida" se mexe na senha ' +
      "do role — resolva o problema de conexão e rode `npm run " +
      "db:test:setup` de novo.",
  );
}

await maintenanceClient.$disconnect();

// 3. Aplica o schema + RLS no banco de teste. `prisma migrate deploy` usa
// DIRECT_DATABASE_URL (owner) para aplicar e DATABASE_URL (app_user) só na
// geração do client — ambos já vêm de apps/api/.env.test no ambiente atual.
console.log("→ Aplicando schema e RLS no banco de teste (prisma migrate deploy)...");
try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: apiRoot,
    env: process.env,
    stdio: "inherit",
    shell: true,
  });
} catch {
  fail(
    "Falha ao aplicar as migrations no banco de teste (prisma migrate " +
      "deploy). Veja a saída acima para detalhes.",
  );
}

// 4. Aplica a senha do role app_user — SÓ na primeira vez, quando o role
// ainda não existe no cluster. As permissões dele no database de teste
// (GRANT nas tabelas, CONNECT) já vêm da migration do passo 3; este passo
// não tem nada a fazer além de criar o role com a senha certa quando ele
// simplesmente não existe ainda. Se o role já existe, rodar
// provision-db-role.mjs de novo executaria `ALTER ROLE app_user WITH LOGIN
// PASSWORD '...'` usando o APP_USER_PASSWORD de .env.test — e como o role é
// do CLUSTER (não do database), isso reescreveria a senha também para o
// ambiente de desenvolvimento, silenciosamente. Por isso este passo é
// pulado quando o role já existe.
if (!appUserRoleExists) {
  console.log(
    '→ Role "app_user" ainda não existe no cluster — provisionando a ' +
      "senha pela primeira vez (db:provision-role)...",
  );
  try {
    execFileSync("node", ["scripts/provision-db-role.mjs"], {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
    });
  } catch {
    fail(
      "Falha ao provisionar a senha do role app_user no banco de teste. Veja a " +
        "saída acima para detalhes.",
    );
  }
} else {
  console.log(
    '✅ Role "app_user" já existe no servidor Postgres — a senha dele NÃO ' +
      "foi tocada de propósito, porque esse role é compartilhado com o " +
      "ambiente de desenvolvimento (mudar a senha aqui também mudaria a " +
      "senha de lá). Se o login do banco de teste falhar por senha, abra " +
      "apps/api/.env.test num editor de texto e troque o valor de " +
      "APP_USER_PASSWORD pelo mesmo valor que está em apps/api/.env (o " +
      "arquivo do ambiente de desenvolvimento). Os dois precisam ser " +
      "idênticos.",
  );
}

console.log(`✅ Banco de teste "${databaseName}" pronto para a suíte.`);
