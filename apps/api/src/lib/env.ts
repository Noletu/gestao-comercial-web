import { z } from "zod";

/**
 * Schema das variáveis de ambiente consumidas pela API.
 *
 * A partir da issue #2 validamos também o banco e a chave de criptografia. As
 * credenciais da Nuvemshop entram na #6, quando forem de fato consumidas.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  // Runtime (role app_user, RLS aplicado).
  DATABASE_URL: z.string().url(),
  // Migrations/seed (role owner). Opcional no runtime do servidor.
  DIRECT_DATABASE_URL: z.string().url().optional(),
  // Chave AES-256-GCM, base64 de 32 bytes (= 44 chars com padding).
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "ENCRYPTION_KEY deve ser base64 de exatamente 32 bytes.",
    }),
  // Segredo do Better Auth (assina sessões/tokens). Mínimo 32 chars.
  BETTER_AUTH_SECRET: z.string().min(32),
  // URL pública da própria API (base do Better Auth).
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  // Origem do front (Next) — usada em CORS e trustedOrigins do Better Auth.
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),

  // ── Nuvemshop (OAuth + API de recursos) ───────────────────────────────────
  // client_id É o app_id do app no portal (34160). client_secret é SEGREDO e só
  // é usado server-side na troca do code por token. Ambos OPCIONAIS no schema
  // para não quebrar o boot/testes de quem não mexe na integração; as rotas de
  // OAuth falham com erro claro se faltarem (ver nuvemshop/config.ts).
  NUVEMSHOP_CLIENT_ID: z.string().optional(),
  NUVEMSHOP_CLIENT_SECRET: z.string().optional(),
  // URL pública do NOSSO callback. Configurável por env para alternar entre o
  // túnel (dev: ngrok/cloudflared) e o Railway (prod) SEM mudar código. Deve
  // bater com a "URL de redirecionamento" cadastrada no portal do app.
  NUVEMSHOP_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3001/api/nuvemshop/callback"),
  // Versão da API de recursos (path: /{version}/{store_id}/...).
  NUVEMSHOP_API_VERSION: z.string().default("2025-03"),
  // User-Agent OBRIGATÓRIO em toda chamada (sem ele a Nuvemshop responde 400).
  NUVEMSHOP_USER_AGENT: z
    .string()
    .default("GestaoComercial (regotodigital@gmail.com)"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Falha ruidosa no boot: env inválido é erro de configuração/operação, não de
  // runtime. Queremos quebrar no deploy (cedo e óbvio), não num request perdido
  // em produção com comportamento imprevisível.
  console.error("❌ Variáveis de ambiente inválidas:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
