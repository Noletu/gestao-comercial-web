"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutIcon } from "./icons";

/**
 * Casca da aplicação: sidebar + topo (spec estoque-interface-parte-1.md
 * §4.3/§6.1). Menu lateral só tem o que funciona — Estoque e Sair, nada
 * decorativo (spec §2). Como só existe uma tela de negócio (Estoque), o
 * item de navegação é um indicador de página atual (`aria-current`), não um
 * link — não há para onde navegar.
 *
 * Contraste (spec §6.3, mínimo 4.5:1): `--accent` como COR DE TEXTO só
 * alcança 4.14:1 sobre `--surface-raised` e 4.4956:1 sobre `--surface` — que
 * REPROVA, por pouco. O item ativo do menu por isso usa fundo `--bg`, onde o
 * mesmo magenta dá 4.8058:1.
 *
 * Abaixo de 768px a sidebar some e vira uma barra superior (spec §4.3):
 * implementado com duas marcações (`hidden md:flex` / `flex md:hidden`),
 * puramente por CSS — sem detecção de viewport em JS. O "Sair" vive nesses
 * dois lugares e só neles: um por largura, nunca os dois ao mesmo tempo.
 */

interface AppShellProps {
  userName: string;
  onLogout: () => void;
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AppShell({
  userName,
  onLogout,
  title,
  subtitle,
  children,
}: AppShellProps): JSX.Element {
  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Sidebar (desktop, >=768px) */}
        <aside className="hidden w-[232px] shrink-0 flex-col justify-between border-r border-border bg-surface p-4 md:flex">
          <div className="flex flex-col gap-6">
            <p className="text-sm font-semibold leading-tight">Gestão Comercial</p>
            <nav aria-label="Navegação principal" className="flex flex-col gap-1">
              <span
                aria-current="page"
                className="flex items-center gap-2 rounded border-l-2 border-accent bg-bg px-3 py-2 text-sm font-semibold text-accent"
              >
                Estoque
              </span>
            </nav>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <LogoutIcon className="h-4 w-4" />
            Sair
          </button>
        </aside>

        {/* Barra superior (mobile, <768px) */}
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <p className="text-sm font-semibold">Gestão Comercial · Estoque</p>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sair da conta"
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <LogoutIcon className="h-4 w-4" />
            Sair
          </button>
        </header>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-col gap-1 border-b border-border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-8">
            <div>
              <h1 className="text-lg font-semibold sm:text-2xl">{title}</h1>
              <p className="text-sm text-text-muted">{subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="hidden text-sm text-text-muted md:inline">{userName}</span>
              <Link
                href="/two-factor"
                className="text-sm text-text-muted underline hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Ativar verificação em duas etapas (2FA)
              </Link>
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-4 px-4 py-4 md:px-8 md:py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
