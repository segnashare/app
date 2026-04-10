"use client";

import Link from "next/link";
import { useState } from "react";

import { SegnaDialogDismissButton, SegnaDialogTitleRow } from "@/components/ui/SegnaAppDialog";

/**
 * Bandeau « envoi regroupé » : fermeture locale. Le parent doit passer une `key` stable par jeu d’ids
 * pour réinitialiser l’état si les candidats changent.
 */
export function ExchangeMergeShippingBanner({
  candidateIds,
  mergeHref,
}: {
  candidateIds: string[];
  mergeHref: string;
}) {
  const visible = candidateIds.length >= 2 && candidateIds.length <= 5;
  const [dismissed, setDismissed] = useState(false);

  if (!visible || dismissed) return null;

  return (
    <div
      className="relative space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
      role="dialog"
      aria-labelledby="merge-shipping-title"
    >
      <SegnaDialogDismissButton onClick={() => setDismissed(true)} />
      <div className="pr-10">
        <SegnaDialogTitleRow
          id="merge-shipping-title"
          title={`${candidateIds.length} pièces à expédier`}
        />
        <p className="text-[14px] leading-relaxed text-zinc-600">
          Tu peux préparer <span className="font-semibold text-zinc-800">un envoi regroupé</span> (même colis vers
          Segna). Ouvre la page transverse pour la liste et le bordereau.
        </p>
        <Link
          href={mergeHref}
          className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Expédition fusionnée
        </Link>
      </div>
    </div>
  );
}
