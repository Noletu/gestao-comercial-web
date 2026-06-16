"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    // O link de reset aponta para /reset-password (no MVP, o backend loga o link).
    await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    // Mensagem genérica de propósito: não revelar se o e-mail existe.
    setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold">Recuperar senha</h1>
      {sent ? (
        <p className="text-sm text-gray-700">
          Se o e-mail existir, enviamos um link para redefinir a senha.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            E-mail
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border border-gray-300 p-2"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-gray-900 p-2 font-medium text-white disabled:opacity-50"
          >
            {loading ? "Enviando..." : "Enviar link"}
          </button>
        </form>
      )}
      <Link href="/login" className="text-sm text-gray-600 underline">
        Voltar para o login
      </Link>
    </main>
  );
}
