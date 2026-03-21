"use client";

import { useState } from "react";

import { Playfair_Display } from "next/font/google";

import { CardBase } from "@/components/layout/CardBase";
import { SectionBlock } from "@/components/layout/SectionBlock";
import { cn } from "@/lib/utils/cn";

const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["600", "700", "800"] });

type HistoryOrder = {
  id: string;
  status: string;
  updatedAt: string;
};

type ExchangeInteractionsSectionProps = {
  totalOrders: number;
  recentOrders: HistoryOrder[];
  disputesCount: number;
};

type ExchangeTab = "history" | "report";

export function ExchangeInteractionsSection({ totalOrders, recentOrders, disputesCount }: ExchangeInteractionsSectionProps) {
  const [activeTab, setActiveTab] = useState<ExchangeTab>("history");
  const [reportText, setReportText] = useState("");

  return (
    <SectionBlock title="Échanges passés" className="w-full bg-white px-5 py-4" titleClassName={cn(playfairDisplay.className, "text-[30px] font-bold leading-none")}>
      <CardBase className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={cn(
              "inline-flex h-11 items-center justify-center rounded-xl border text-sm font-semibold transition",
              activeTab === "history" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800",
            )}
          >
            Historique
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("report")}
            className={cn(
              "inline-flex h-11 items-center justify-center rounded-xl border text-sm font-semibold transition",
              activeTab === "report" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800",
            )}
          >
            Signalement
          </button>
        </div>

        {activeTab === "history" ? (
          <div className="space-y-3">
            {recentOrders.length > 0 ? (
              <div className="space-y-2">
                {recentOrders.map((order) => (
                  <article key={order.id} className="rounded-xl border border-zinc-200 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.04em] text-zinc-500">{order.id.slice(0, 8)}</p>
                    <p className="mt-1 text-sm font-medium text-zinc-800">Statut: {order.status}</p>
                    <p className="mt-1 text-xs text-zinc-500">Maj: {order.updatedAt}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
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
          </div>
        )}
      </CardBase>
    </SectionBlock>
  );
}
