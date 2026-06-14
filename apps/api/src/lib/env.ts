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
