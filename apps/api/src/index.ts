// Carrega apps/api/.env antes de qualquer leitura de process.env (env.ts valida).
import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./lib/env.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(
    `🚀 API rodando em http://localhost:${env.PORT} (${env.NODE_ENV})`,
  );
});
