/**
 * Ícones inline (SVG, sem biblioteca — spec estoque-interface-parte-1.md
 * §6.3). Não faz parte da lista de arquivos do §6.1, mas evita repetir o
 * mesmo markup de ícone em cada componente que precisa de um (decisão
 * técnica, registrada no relatório da implementação). Todo ícone é
 * puramente decorativo (`aria-hidden`) — o rótulo acessível vive no
 * elemento interativo que o envolve (`aria-label` do botão), nunca no
 * ícone em si.
 */

type IconProps = { className?: string };

const commonProps = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function SearchIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M17 17l-4-4" />
    </svg>
  );
}

export function FilterIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M3 4h14M6 10h8M9 16h2" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M12.5 3.5l4 4L6 18H2v-4L12.5 3.5z" />
    </svg>
  );
}

export function MoveIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M10 2v16M5 6l5-4 5 4M5 14l5 4 5-4" />
    </svg>
  );
}

/**
 * Ícone de "inativar" — desenhado de propósito como um símbolo de
 * liga/desliga (não uma lixeira: a spec proíbe qualquer ícone de exclusão
 * em qualquer lugar da tela, §4.3/§2, porque inativar não apaga nada). Um
 * ícone de caixa com tampa, mesmo rotulado "Inativar", lembra visualmente
 * uma lixeira à primeira vista — o símbolo liga/desliga não tem essa
 * ambiguidade e combina com o `UndoIcon` usado para "Reativar".
 */
export function PowerIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M10 3v6" />
      <path d="M6 5.5a6 6 0 108 0" />
    </svg>
  );
}

export function UndoIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M4 8h8a4 4 0 110 8H9" />
      <path d="M7 4L4 8l3 4" />
    </svg>
  );
}

export function WarningIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M10 3l8 14H2z" />
      <path d="M10 8.5v3.2" />
      <circle cx="10" cy="14.3" r="0.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps): JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M8 4H4v12h4" />
      <path d="M17 10H8M13.5 6.5L17 10l-3.5 3.5" />
    </svg>
  );
}
