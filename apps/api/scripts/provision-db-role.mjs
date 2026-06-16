// ─────────────────────────────────────────────────────────────────────────────
// Provisionamento da senha do role de runtime (app_user) — GATE 1, issue #4.
//
// Por quê: a senha do `app_user` NÃO pode viver no SQL versionado (repo público).
// A migration cria o role SEM senha; este script aplica a senha real a partir de
// `APP_USER_PASSWORD` (em prod, um secret do Railway). É idempotente: pode rodar
// a cada deploy. Conecta como OWNER/superusuário (DIRECT_DATABASE_URL) porque só
// o owner pode `ALTER ROLE`.
//
// .mjs puro (sem TypeScript/tsx) de propósito: roda com `node` direto no release
// de produção, sem depender de build nem de devDependencies.
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";

const password = process.env.APP_USER_PASSWORD;
if (!password) {
  console.error(
    "❌ APP_USER_PASSWORD ausente. Defina o secret antes de provisionar o role.",
  );
  process.exit(1);
}

// O owner é quem pode mexer em roles. Sem DIRECT_DATABASE_URL caímos no DATABASE_URL
// (em dev local o mesmo Postgres), mas em prod o correto é o owner.
const ownerUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error("❌ DIRECT_DATABASE_URL (owner) ausente.");
  process.exit(1);
}

// Escapa aspas simples para um literal SQL seguro. Num literal entre aspas simples
// o único metacaractere é a própria aspa simples (standard_conforming_strings=on,
// default do Postgres) → dobrá-la basta para evitar injeção.
const safePassword = password.replace(/'/g, "''");

const prisma = new PrismaClient({ datasourceUrl: ownerUrl });

try {
  // Garante o role (idempotente) e aplica a senha do ambiente. Se a migration já
  // criou o role, o CREATE é pulado e só o ALTER (senha) tem efeito.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN;
      END IF;
    END
    $$;
  `);
  await prisma.$executeRawUnsafe(
    `ALTER ROLE app_user WITH LOGIN PASSWORD '${safePassword}'`,
  );
  console.log("✅ Senha do role app_user provisionada a partir do ambiente.");
} catch (err) {
  console.error("❌ Falha ao provisionar o role app_user:", err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
