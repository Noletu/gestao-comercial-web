"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Status {
  connected: boolean;
  storeId: string | null;
  status: string | null;
}

/**
 * Cartão de integração com a Nuvemshop no painel.
 *
 * O botão dispara uma navegação de página inteira para `GET /api/nuvemshop/connect`
 * (não um fetch): o backend responde 302 para a Nuvemshop, e a navegação carrega o
 * cookie de sessão. O feedback de volta vem na query (`?nuvemshop=connected|error`),
 * que lemos de `window.location` para não exigir Suspense de useSearchParams.
 */
export function NuvemshopCard(): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ns = params.get("nuvemshop");
    if (ns === "connected") setFlash("Loja conectada com sucesso. ✅");
    else if (ns === "error")
      setFlash(
        `Falha ao conectar (${params.get("reason") ?? "desconhecida"}).`,
      );

    void (async () => {
      const res = await fetch(`${API}/api/nuvemshop/status`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as Status;
      setStatus(data);
      if (!data.connected) return;
      // Chamada autenticada real à API da loja — prova de que a conexão funciona.
      const storeRes = await fetch(`${API}/api/nuvemshop/store`, {
        credentials: "include",
      });
      if (storeRes.ok) {
        const store = (await storeRes.json()) as { name: string | null };
        setStoreName(store.name);
      }
    })();
  }, []);

  return (
    <div className="rounded border border-gray-200 p-4 text-sm">
      <p className="mb-2 font-medium">Integração Nuvemshop</p>
      {flash && <p className="mb-2 text-gray-700">{flash}</p>}
      {status?.connected ? (
        <p className="text-green-700">
          Conectada — loja {storeName ?? status.storeId}
        </p>
      ) : (
        <>
          {status?.status === "ERROR" && (
            <p className="mb-2 text-red-600">
              Conexão com erro — reconecte a loja.
            </p>
          )}
          <button
            onClick={() => {
              window.location.href = `${API}/api/nuvemshop/connect`;
            }}
            className="rounded bg-gray-900 px-3 py-2 font-medium text-white"
          >
            Conectar Nuvemshop
          </button>
        </>
      )}
    </div>
  );
}
