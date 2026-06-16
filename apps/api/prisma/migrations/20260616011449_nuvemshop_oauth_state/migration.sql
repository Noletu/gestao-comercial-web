-- CreateTable
CREATE TABLE "nuvemshop_oauth_state" (
    "id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nuvemshop_oauth_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nuvemshop_oauth_state_state_key" ON "nuvemshop_oauth_state"("state");

-- AddForeignKey
ALTER TABLE "nuvemshop_oauth_state" ADD CONSTRAINT "nuvemshop_oauth_state_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  SQL ESCRITO À MÃO — Row-Level Security na tabela de state do OAuth.        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- Os privilégios do app_user (SELECT/INSERT/UPDATE/DELETE) já são herdados via
-- ALTER DEFAULT PRIVILEGES da migration inicial — aqui basta ligar o RLS.
--
-- A POLICY isola por tenant_id (mesmo padrão das demais tabelas). A ESCRITA no
-- /connect roda no escopo do tenant (withTenant → WITH CHECK casa). A LEITURA no
-- /callback usa o client ADMIN (bypassa RLS): resolver "qual tenant iniciou este
-- state" é, por natureza, cross-tenant (identidade), como a busca de membership
-- no requireAuth. O `state` é aleatório de alta entropia e não é segredo.
ALTER TABLE "nuvemshop_oauth_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nuvemshop_oauth_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "nuvemshop_oauth_state"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
