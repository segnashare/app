"use client";

import { Loader2 } from "lucide-react";

export type UberDirectQuotePhase = "invite" | "need_address" | "loading" | "ok" | "error";

type UberDirectQuotePanelProps = {
  phase: UberDirectQuotePhase;
  errorMessage: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
};

function uberErrorTitle(code: string | null | undefined): string {
  switch (code) {
    case "address_undeliverable":
      return "Hors zone";
    case "invalid_client":
      return "Indisponible";
    default:
      return "Pas de tarif";
  }
}

/**
 * État secondaire (chargement, erreur, adresse) sous l’option Express.
 * L’estimation d’heure d’arrivée et le prix TTC sont affichés sur la carte parente.
 */
export function UberDirectQuotePanel({
  phase,
  errorMessage,
  errorCode,
  errorDetail,
}: UberDirectQuotePanelProps) {
  if (phase === "invite" || phase === "ok") {
    return null;
  }
  if (phase === "need_address") {
    return <p className="mt-1.5 text-left text-[13px] text-zinc-500">Ajoute une adresse pour voir le délai.</p>;
  }
  if (phase === "loading") {
    return (
      <div className="mt-1.5 flex items-center gap-2 text-[13px] text-zinc-500">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" aria-hidden />
        <span>Estimation…</span>
      </div>
    );
  }
  if (phase === "error") {
    const title = uberErrorTitle(errorCode);
    const body = errorMessage?.trim() ?? "Réessaie dans un instant.";
    return (
      <div className="mt-1.5 text-left text-[13px]">
        <p className="font-medium text-zinc-900">{title}</p>
        <p className="mt-0.5 text-zinc-600">{body}</p>
        {errorCode === "address_undeliverable" ? <p className="mt-1.5 text-[12px] text-zinc-400">Modifie l’adresse ci-dessus.</p> : null}
        {errorDetail?.trim() ? (
          <details className="mt-2 border-t border-zinc-100 pt-2">
            <summary className="cursor-pointer text-[11px] font-medium text-zinc-400">Détails</summary>
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-50 p-2 text-[10px] text-zinc-600">
              {errorDetail.trim()}
            </pre>
          </details>
        ) : null}
      </div>
    );
  }
  return null;
}
