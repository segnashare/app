"use client";

import { Loader2 } from "lucide-react";

export type UberDirectQuotePhase = "invite" | "need_address" | "loading" | "ok" | "error";

type UberDirectQuotePanelProps = {
  phase: UberDirectQuotePhase;
  errorMessage: string | null;
  errorCode?: string | null;
};

/** Libellé court à afficher à la place du prix (carte parente). */
export function uberDirectUnavailablePriceLabel(code: string | null | undefined): string {
  switch (code) {
    case "address_undeliverable":
      return "Hors Zone";
    case "invalid_client":
      return "Indisponible";
    default:
      return "Indisponible";
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
    const body = errorMessage?.trim() ?? "Réessaie dans un instant.";
    return (
      <div className="mt-1.5 text-center text-[13px] leading-relaxed text-zinc-600">
        <p>{body}</p>
      </div>
    );
  }
  return null;
}
