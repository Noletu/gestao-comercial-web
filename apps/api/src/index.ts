import { createApp } from "./app";
import { env } from "./lib/env";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(
    `🚀 API rodando em http://localhost:${env.PORT} (${env.NODE_ENV})`,
  );
});
