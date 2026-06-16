import { Router } from "express";
import { env } from "../lib/env.js";
import { requireAuth } from "../middlewares/requireAuth.middleware.js";
import { nuvemshopClient } from "../nuvemshop/client.js";
import {
  consumeState,
  exchangeCodeForToken,
  startInstall,
  upsertConnection,
} from "../nuvemshop/oauth.js";
import { NuvemshopNotConnectedError } from "../nuvemshop/errors.js";

/**
 * Fluxo OAuth da Nuvemshop: iniciar instalação → callback → conexão cifrada.
 *
 * Segurança do callback (não-negociável): ele NÃO confia no cliente. A ligação
 * "este redirect pertence a este tenant" vem do `state` que nós emitimos no
 * /connect (e que a Nuvemshop devolve), não de header/sessão forjáveis.
 */
export const nuvemshopRouter = Router();

const PANEL = `${env.WEB_ORIGIN}/dashboard`;

/** Para onde devolvemos o lojista após o callback, com feedback na query. */
function panelRedirect(status: "connected" | "error", reason?: string): string {
  const url = new URL(PANEL);
  url.searchParams.set("nuvemshop", status);
  if (reason) url.searchParams.set("reason", reason);
  return url.toString();
}

// 1) Iniciar instalação (autenticado). Gera o state ligado ao tenant e manda o
//    lojista para a tela de autorização da Nuvemshop.
nuvemshopRouter.get("/connect", requireAuth, (req, res, next) => {
  void (async () => {
    const { authorizeUrl } = await startInstall(req.tenantId!);
    res.redirect(authorizeUrl);
  })().catch(next);
});

// 2) Callback (público, mas validado por state). Recebe code + state da
//    Nuvemshop, valida o state, troca o code por token e persiste a conexão.
nuvemshopRouter.get("/callback", (req, res) => {
  void (async () => {
    const code =
      typeof req.query.code === "string" ? req.query.code : undefined;
    const state =
      typeof req.query.state === "string" ? req.query.state : undefined;

    // (a) state inválido/ausente/expirado → rejeita ANTES de qualquer troca.
    const tenantId = await consumeState(state);
    if (!tenantId) {
      res.redirect(panelRedirect("error", "state_invalido"));
      return;
    }
    if (!code) {
      res.redirect(panelRedirect("error", "code_ausente"));
      return;
    }

    // (b) troca server-side (client_secret só vive aqui) e (c) persiste cifrado.
    const conn = await exchangeCodeForToken(code);
    await upsertConnection(tenantId, conn);

    // (d) volta ao painel com sucesso.
    res.redirect(panelRedirect("connected"));
  })().catch((err: unknown) => {
    // Falha na troca/persistência: feedback genérico, sem vazar detalhes.
    console.error("[nuvemshop] callback falhou:", (err as Error)?.name);
    res.redirect(panelRedirect("error", "falha_conexao"));
  });
});

// 3) Status da conexão (autenticado, só DB — rápido, serve para o painel poll).
nuvemshopRouter.get("/status", requireAuth, (req, res, next) => {
  void (async () => {
    const conn = await req.db!.nuvemshopConnection.findUnique({
      where: { tenantId: req.tenantId! },
      select: { storeId: true, status: true },
    });
    res.json({
      connected: conn?.status === "ACTIVE",
      storeId: conn?.storeId ?? null,
      status: conn?.status ?? null,
    });
  })().catch(next);
});

// 4) Prova de fim-a-fim: chamada autenticada real à API da loja (`GET /store`).
//    O painel usa para exibir o nome da loja conectada.
nuvemshopRouter.get("/store", requireAuth, (req, res, next) => {
  void (async () => {
    try {
      const client = await nuvemshopClient(req.tenantId!);
      const store = await client.getStore();
      // O nome da loja na Nuvemshop pode vir como string ou objeto localizado
      // ({ pt: "..." }); normalizamos para exibição no painel.
      const name =
        typeof store.name === "string"
          ? store.name
          : typeof store.name === "object" && store.name
            ? Object.values(store.name as Record<string, unknown>)[0]
            : null;
      res.json({ storeId: client.storeId, name });
    } catch (err) {
      if (err instanceof NuvemshopNotConnectedError) {
        res.status(404).json({ error: "Loja não conectada." });
        return;
      }
      throw err;
    }
  })().catch(next);
});
