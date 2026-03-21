"use client";

import { useState } from "react";

import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";

type ExchangeReportSectionProps = {
  disputesCount: number;
};

export function ExchangeReportSection({ disputesCount }: ExchangeReportSectionProps) {
  const [reportText, setReportText] = useState("");

  return (
    <SectionBlock title="Signalement" description="Signale un probleme sur une commande ou une piece.">
      <CardBase className="space-y-3">
        <div className="rounded-xl bg-zinc-50 px-3 py-2">
          <p className="text-sm text-zinc-700">Signalements deja ouverts: {disputesCount}</p>
        </div>

        <label htmlFor="exchange-report" className="text-sm font-medium text-zinc-700">
          Decris le probleme
        </label>
        <textarea
          id="exchange-report"
          value={reportText}
          onChange={(event) => setReportText(event.target.value)}
          rows={4}
          placeholder="Ex: piece recue tachee, piece manquante, retard de retour..."
          className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-800 outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-300"
        />
        <button
          type="button"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!reportText.trim()}
        >
          Envoyer le signalement
        </button>
      </CardBase>
    </SectionBlock>
  );
}
