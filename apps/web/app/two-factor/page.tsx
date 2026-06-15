"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { authClient } from "@/lib/auth-client";

/** Modo "verify": segundo fator durante o login (veio do redirect do /login). */
function VerifyDuringLogin() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setError("Código inválido.");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-gray-700">
        Digite o código do seu app autenticador.
      </p>
      <input
        inputMode="numeric"
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="rounded border border-gray-300 p-2 tracking-widest"
        placeholder="000000"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        className="rounded bg-gray-900 p-2 font-medium text-white"
      >
        Verificar
      </button>
    </form>
  );
}

/** Modo "setup": ativar 2FA (precisa estar logado). */
function SetupTwoFactor() {
  const [password, setPassword] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");

  async function onEnable(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data) {
      setError(error?.message ?? "Não foi possível ativar o 2FA.");
      return;
    }
    setQr(await QRCode.toDataURL(data.totpURI));
  }

  async function onConfirm(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setError("Código inválido. Tente novamente.");
      return;
    }
    setEnabled(true);
  }

  if (enabled) {
    return (
      <p className="text-sm text-green-700">2FA ativado com sucesso. ✅</p>
    );
  }

  if (qr) {
    return (
      <form onSubmit={onConfirm} className="flex flex-col gap-4">
        <p className="text-sm text-gray-700">
          Escaneie o QR no seu app autenticador e confirme o código:
        </p>
        <Image
          src={qr}
          alt="QR code TOTP"
          width={200}
          height={200}
          unoptimized
        />
        <input
          inputMode="numeric"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="rounded border border-gray-300 p-2 tracking-widest"
          placeholder="000000"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="rounded bg-gray-900 p-2 font-medium text-white"
        >
          Confirmar
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onEnable} className="flex flex-col gap-4">
      <p className="text-sm text-gray-700">
        Ative a verificação em duas etapas (opcional). Confirme sua senha:
      </p>
      <input
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded border border-gray-300 p-2"
        placeholder="Senha atual"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        className="rounded bg-gray-900 p-2 font-medium text-white"
      >
        Ativar 2FA
      </button>
    </form>
  );
}

function TwoFactorContent() {
  const searchParams = useSearchParams();
  const isVerify = searchParams?.get("verify") === "1";
  return isVerify ? <VerifyDuringLogin /> : <SetupTwoFactor />;
}

export default function TwoFactorPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold">Verificação em duas etapas</h1>
      <Suspense
        fallback={<p className="text-sm text-gray-500">Carregando...</p>}
      >
        <TwoFactorContent />
      </Suspense>
      <Link href="/dashboard" className="text-sm text-gray-600 underline">
        Voltar
      </Link>
    </main>
  );
}
