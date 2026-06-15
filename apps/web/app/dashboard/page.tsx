"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Me {
  user: { id: string; email: string; name: string } | null;
  tenantId: string;
  role: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // O gate REAL é aqui: pedimos /api/me ao backend. Se a sessão não vale, o
    // Express responde 401 e redirecionamos. O front não decide autorização.
    fetch(`${API}/api/me`, { credentials: "include" })
      .then(async (r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return (await r.json()) as Me;
      })
      .then((data) => {
        if (data) setMe(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  async function onLogout(): Promise<void> {
    await authClient.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-gray-500">Carregando...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Painel</h1>
      <p className="text-gray-600">Estoque — em construção.</p>
      {me?.user && (
        <div className="rounded border border-gray-200 p-4 text-sm">
          <p>
            <strong>Usuário:</strong> {me.user.name} ({me.user.email})
          </p>
          <p>
            <strong>Loja ativa:</strong> {me.tenantId}
          </p>
          <p>
            <strong>Papel:</strong> {me.role}
          </p>
        </div>
      )}
      <Link href="/two-factor" className="text-sm text-gray-700 underline">
        Ativar verificação em duas etapas (2FA)
      </Link>
      <button
        onClick={onLogout}
        className="rounded border border-gray-300 p-2 text-sm font-medium"
      >
        Sair
      </button>
    </main>
  );
}
