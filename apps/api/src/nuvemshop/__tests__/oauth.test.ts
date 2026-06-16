import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { adminPrisma, decrypt, prisma } from "../../db/index.js";
import {
  consumeState,
  exchangeCodeForToken,
  startInstall,
  upsertConnection,
} from "../oauth.js";
import { nuvemshopClient } from "../client.js";
import { NuvemshopAuthError, NuvemshopRateLimitError } from "../errors.js";

/**
 * Provas dos não-negociáveis do fluxo OAuth da Nuvemshop:
 *  - `state` anti-CSRF: uso único, expira, e callback rejeita state inválido;
 *  - troca de code por token é server-side (mockada) e mapeia user_id→store_id;
 *  - persistência idempotente (reinstalar regenera o token, não duplica);
 *  - token guardado CIFRADO; cliente HTTP trata 401 (invalida) e 429 (backoff).
 */

const app = createApp();

async function truncateAll(): Promise<void> {
  await adminPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE "nuvemshop_oauth_state","nuvemshop_connection",` +
      `"membership","tenant","user" RESTART IDENTITY CASCADE`,
  );
}

let tenantId: string;

beforeAll(async () => {
  // Credenciais de teste (lidas tardiamente por getCredentials → process.env).
  process.env.NUVEMSHOP_CLIENT_ID = "34160";
  process.env.NUVEMSHOP_CLIENT_SECRET = "test-secret";
  await truncateAll();
  const tenant = await adminPrisma.tenant.create({ data: { name: "Loja" } });
  tenantId = tenant.id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
  await adminPrisma.$disconnect();
});

describe("state anti-CSRF", () => {
  it("startInstall gera authorizeUrl com app_id e persiste o state", async () => {
    const { authorizeUrl, state } = await startInstall(tenantId);
    expect(authorizeUrl).toContain("/apps/34160/authorize");
    expect(authorizeUrl).toContain(`state=${encodeURIComponent(state)}`);
    const row = await adminPrisma.nuvemshopOauthState.findUnique({
      where: { state },
    });
    expect(row?.tenantId).toBe(tenantId);
  });

  it("consumeState devolve o tenant e invalida o state (uso único)", async () => {
    const { state } = await startInstall(tenantId);
    expect(await consumeState(state)).toBe(tenantId);
    // Segundo uso falha — o state foi apagado.
    expect(await consumeState(state)).toBeNull();
  });

  it("consumeState rejeita state ausente ou inexistente", async () => {
    expect(await consumeState(undefined)).toBeNull();
    expect(await consumeState("nao-existe")).toBeNull();
  });

  it("consumeState rejeita state expirado", async () => {
    const { state } = await startInstall(tenantId);
    // Força a expiração no passado (via admin, fora do TTL).
    await adminPrisma.nuvemshopOauthState.update({
      where: { state },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeState(state)).toBeNull();
  });
});

describe("troca de code por token", () => {
  it("mapeia user_id→store_id e extrai o scope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "tok_abc",
          token_type: "bearer",
          scope: "read_products,write_products",
          user_id: 7837533,
        }),
        { status: 200 },
      ),
    );
    const conn = await exchangeCodeForToken("code123");
    expect(conn.storeId).toBe("7837533");
    expect(conn.accessToken).toBe("tok_abc");
    expect(conn.scope).toBe("read_products,write_products");
  });

  it("lança erro quando a resposta não traz access_token/user_id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token_type: "bearer" }), { status: 200 }),
    );
    await expect(exchangeCodeForToken("code123")).rejects.toThrow();
  });
});

describe("persistência idempotente", () => {
  it("reinstalar regenera o token sem duplicar a conexão", async () => {
    await upsertConnection(tenantId, {
      storeId: "7837533",
      accessToken: "tok_v1",
      scope: "read_products",
    });
    await upsertConnection(tenantId, {
      storeId: "7837533",
      accessToken: "tok_v2",
      scope: "read_products,write_products",
    });

    const conns = await adminPrisma.nuvemshopConnection.findMany({
      where: { tenantId },
    });
    expect(conns).toHaveLength(1); // não duplicou
    expect(decrypt(conns[0]!.accessTokenEncrypted)).toBe("tok_v2"); // regenerou
    expect(conns[0]!.accessTokenEncrypted).not.toContain("tok_v2"); // cifrado
  });
});

describe("callback HTTP (segurança)", () => {
  beforeEach(async () => {
    await adminPrisma.nuvemshopConnection.deleteMany({ where: { tenantId } });
    await adminPrisma.nuvemshopOauthState.deleteMany({ where: { tenantId } });
  });

  it("rejeita callback com state inválido (não troca token nem conecta)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await request(app).get(
      "/api/nuvemshop/callback?code=abc&state=forjado",
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("nuvemshop=error");
    expect(res.headers.location).toContain("reason=state_invalido");
    expect(fetchSpy).not.toHaveBeenCalled(); // nunca tentou trocar o token
    const conn = await adminPrisma.nuvemshopConnection.findUnique({
      where: { tenantId },
    });
    expect(conn).toBeNull();
  });

  it("com state válido: troca token, persiste cifrado e redireciona sucesso", async () => {
    const { state } = await startInstall(tenantId);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "tok_live",
          token_type: "bearer",
          scope: "read_products",
          user_id: 7837533,
        }),
        { status: 200 },
      ),
    );
    const res = await request(app).get(
      `/api/nuvemshop/callback?code=realcode&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("nuvemshop=connected");

    const conn = await adminPrisma.nuvemshopConnection.findUnique({
      where: { tenantId },
    });
    expect(conn?.storeId).toBe("7837533");
    expect(decrypt(conn!.accessTokenEncrypted)).toBe("tok_live");
  });
});

describe("cliente HTTP", () => {
  beforeEach(async () => {
    await adminPrisma.nuvemshopConnection.deleteMany({ where: { tenantId } });
    await upsertConnection(tenantId, {
      storeId: "7837533",
      accessToken: "tok_client",
      scope: "read_products",
    });
  });

  it("getStore injeta auth/UA e retorna os dados da loja", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 7837533, name: "Regototeste" }), {
        status: 200,
      }),
    );
    const client = await nuvemshopClient(tenantId);
    const store = await client.getStore();
    expect(store.name).toBe("Regototeste");

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/2025-03/7837533/store");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authentication).toBe("bearer tok_client");
    expect(headers["User-Agent"]).toBeTruthy();
  });

  it("401 marca a conexão como ERROR e lança NuvemshopAuthError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    const client = await nuvemshopClient(tenantId);
    await expect(client.getStore()).rejects.toBeInstanceOf(NuvemshopAuthError);
    const conn = await adminPrisma.nuvemshopConnection.findUnique({
      where: { tenantId },
    });
    expect(conn?.status).toBe("ERROR");
  });

  it("429 lança NuvemshopRateLimitError com retryAfter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "3" },
      }),
    );
    const client = await nuvemshopClient(tenantId);
    await expect(client.getStore()).rejects.toMatchObject({
      name: "NuvemshopRateLimitError",
      retryAfterSeconds: 3,
    });
    expect(NuvemshopRateLimitError).toBeTruthy();
  });
});
