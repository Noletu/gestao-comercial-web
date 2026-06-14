-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'STAFF', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DRAFT');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PURCHASE_ENTRY', 'SALE', 'ADJUSTMENT', 'RETURN', 'SYNC_CORRECTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "MovementSource" AS ENUM ('APP', 'NUVEMSHOP_WEBHOOK', 'INITIAL_SYNC');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncEntityType" AS ENUM ('PRODUCT', 'VARIANT', 'INVENTORY_LEVEL', 'LOCATION');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'OUT_OF_SYNC', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nuvemshop_product_id" BIGINT,
    "name" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "nuvemshop_variant_id" BIGINT,
    "sku" TEXT,
    "price" DECIMAL(12,2),
    "cost" DECIMAL(12,2),
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nuvemshop_location_id" TEXT,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_level" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "type" "MovementType" NOT NULL,
    "source" "MovementSource" NOT NULL,
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_ref" TEXT,
    "reversal_of_id" UUID,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nuvemshop_connection" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "scope" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nuvemshop_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" "SyncEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "direction" "SyncDirection" NOT NULL DEFAULT 'BIDIRECTIONAL',
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "membership_tenant_id_idx" ON "membership"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenant_id_user_id_key" ON "membership"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "product_tenant_id_idx" ON "product"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenant_id_nuvemshop_product_id_key" ON "product"("tenant_id", "nuvemshop_product_id");

-- CreateIndex
CREATE INDEX "variant_tenant_id_idx" ON "variant"("tenant_id");

-- CreateIndex
CREATE INDEX "variant_product_id_idx" ON "variant"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_tenant_id_sku_key" ON "variant"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "variant_tenant_id_nuvemshop_variant_id_key" ON "variant"("tenant_id", "nuvemshop_variant_id");

-- CreateIndex
CREATE INDEX "location_tenant_id_idx" ON "location"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_level_tenant_id_idx" ON "inventory_level"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_level_variant_id_location_id_key" ON "inventory_level"("variant_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_movement_tenant_id_idx" ON "stock_movement"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_movement_variant_id_location_id_idx" ON "stock_movement"("variant_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "nuvemshop_connection_tenant_id_key" ON "nuvemshop_connection"("tenant_id");

-- CreateIndex
CREATE INDEX "sync_state_tenant_id_idx" ON "sync_state"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_state_tenant_id_entity_type_entity_id_key" ON "sync_state"("tenant_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant" ADD CONSTRAINT "variant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant" ADD CONSTRAINT "variant_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_level" ADD CONSTRAINT "inventory_level_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_level" ADD CONSTRAINT "inventory_level_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_level" ADD CONSTRAINT "inventory_level_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "stock_movement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nuvemshop_connection" ADD CONSTRAINT "nuvemshop_connection_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  SQL ESCRITO À MÃO (não gerado pelo Prisma)                                ║
-- ║  Multi-tenant via Row-Level Security + ledger imutável.                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Role de aplicação (app_user)
--    SEM superusuário e SEM ser dono das tabelas → o RLS é SEMPRE aplicado a ele.
--    O runtime conecta com este role (DATABASE_URL). Migrations/seed usam o owner
--    (DIRECT_DATABASE_URL), que é superusuário e bypassa o RLS de propósito.
--    Senha de DEV; em produção o role/segredo vêm das variáveis do Railway.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_pw';
  END IF;
END
$$;

-- Permissões mínimas do app_user.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- Tabelas futuras (próximas migrations) herdam os mesmos privilégios.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Ledger imutável (stock_movement = append-only)
--    Defesa em profundidade:
--    (a) app_user perde UPDATE/DELETE na tabela (só SELECT/INSERT);
--    (b) trigger bloqueia UPDATE/DELETE para QUALQUER role (inclusive owner).
--    Correção de estoque é via nova movimentação (REVERSAL), nunca editando.
--    Obs.: TRUNCATE não dispara o trigger de linha → seed/testes limpam via TRUNCATE.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE, DELETE ON "stock_movement" FROM app_user;

CREATE OR REPLACE FUNCTION forbid_stock_movement_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movement e append-only: % nao permitido. Use uma movimentacao REVERSAL.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movement_immutable
  BEFORE UPDATE OR DELETE ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION forbid_stock_movement_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Row-Level Security: isolamento por tenant
--    USING  → filtra linhas na LEITURA (e em UPDATE/DELETE).
--    WITH CHECK → impede ESCRITA com tenant_id de outro tenant.
--    current_setting('app.tenant_id', true): o 2º arg (missing_ok) evita erro
--    quando o GUC não foi setado. Após um set_config LOCAL, porém, o GUC reverte
--    para STRING VAZIA (não NULL) na conexão reusada do pool — por isso o
--    NULLIF(..., ''): vazio vira NULL → nenhuma linha casa → fail-closed.
--    FORCE ... garante o RLS até para o dono da tabela (superusuário ainda bypassa,
--    o que é desejado para migrations/seed).
--    `user` é identidade GLOBAL (sem tenant_id) → sem RLS; o acesso tenant-scoped
--    a usuários passa por `membership`.
-- ─────────────────────────────────────────────────────────────────────────────

-- tenant: filtra pela PRÓPRIA pk (um tenant só enxerga a si mesmo).
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant"
  USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Demais tabelas de negócio: filtram pela coluna tenant_id.
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "membership"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "variant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "variant"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "location" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "location"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "inventory_level" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_level" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inventory_level"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "stock_movement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_movement"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "nuvemshop_connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nuvemshop_connection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "nuvemshop_connection"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "sync_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sync_state"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
