"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import { ExchangeOrderHelpSection } from "@/components/exchange/ExchangeOrderHelpSection";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import type { WalletTransactionDetail } from "@/lib/wallet/fetch-wallet-transaction-detail";
import { cn } from "@/lib/utils/cn";

type WalletTransactionDetailViewProps = {
  detail: WalletTransactionDetail;
  loading?: boolean;
  onBack: () => void;
};

function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

export function WalletTransactionDetailView({ detail, loading = false, onBack }: WalletTransactionDetailViewProps) {
  const signedPrefix = detail.direction === "credit" ? "+" : "−";
  const lines =
    detail.returnContext?.lines ??
    detail.cartContext?.lines ??
    (detail.lendContext ? [detail.lendContext.line] : []);
  const totalPoints =
    detail.cartContext?.totalPoints ??
    detail.returnContext?.lines.reduce((s, l) => s + l.pricePoints, 0) ??
    detail.lendContext?.line.pricePoints ??
    0;
  const commandeHref = detail.returnContext?.commandeHref ?? detail.cartContext?.commandeHref ?? null;
  const orderNumberCompact =
    detail.returnContext?.orderNumberCompact ?? detail.cartContext?.orderNumberCompact ?? null;

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white pb-[max(1.5rem,env(safe-area-inset-bottom,0px)+0.75rem)]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-3">
          <div className="flex w-full items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label="Retour"
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition active:bg-zinc-100"
            >
              <ArrowLeft className="h-8 w-8" strokeWidth={2.25} />
            </button>
            <ExchangeOrderHelpSection placement="header" triggerLabel="Besoin d'aide ?" />
          </div>
          <h1 className={cn("mt-4 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            <span className="inline-flex flex-wrap items-center gap-2">
              {detail.label}
              {detail.isAdminAdjustment ? (
                <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                  Admin
                </span>
              ) : null}
            </span>
          </h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">
            {[detail.contextHint, detail.occurredAtFormatted].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-4 inline-flex items-center gap-1">
            <span className="text-[28px] font-semibold tabular-nums tracking-tight text-zinc-950" aria-hidden>
              {signedPrefix}
            </span>
            <SegnaPointsUnitDisplay
              points={detail.amountPoints}
              creditKind="exchange"
              unitDisplay="icon"
              numberClassName="text-[28px] font-semibold tabular-nums text-zinc-950"
              iconClassName="h-[1.05em] w-[1.05em]"
            />
          </div>
        </div>
      </header>

      {detail.returnContext ? (
        <div className="border-b border-zinc-200 px-5 py-4 text-[15px] leading-relaxed text-zinc-700">
          Tu as récupéré{" "}
          <strong className="font-semibold text-zinc-950">
            {detail.returnContext.creditsReturned.toLocaleString("fr-FR")} crédits
          </strong>{" "}
          sur les{" "}
          <strong className="font-semibold text-zinc-950">
            {detail.returnContext.creditsConsumedOnOrder.toLocaleString("fr-FR")} crédits
          </strong>{" "}
          utilisés pour cette commande.
        </div>
      ) : null}

      {detail.isAdminAdjustment && detail.adminNotice ? (
        <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-4">
          <p className="text-[14px] font-semibold text-zinc-950">Ajustement manuel Segna</p>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">{detail.adminNotice}</p>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-3">
        <section className="border-b border-zinc-200 pb-4 pt-2">
          <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Résumé
          </h2>
          <p className="text-[15px] font-semibold leading-snug text-zinc-900">{detail.statusLine}</p>
          <p className="mt-1 text-[14px] leading-snug text-zinc-500">{detail.label}</p>
          {detail.summaryRows.length > 0 ? (
            <div className="mt-4 space-y-2.5 text-[15px] leading-snug">
              {detail.summaryRows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">{row.label}</span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums text-zinc-900",
                      row.emphasize ? "font-semibold" : "font-medium",
                    )}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {lines.length > 0 ? (
          <section className="border-b border-zinc-200 pb-4 pt-4">
            <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              {detail.lendContext ? "Pièce prêtée" : "Contenu"}
            </h2>
            <CommandeOrderLineRows
              lines={lines}
              creditKind="exchange"
              itemHrefSuffix="?from=wallet"
              pointsUnitDisplay="icon"
            />
            {totalPoints > 0 && !detail.lendContext ? (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-200 pt-4">
                <span className="text-[16px] font-bold text-zinc-900">Total échangé</span>
                <SegnaPointsUnitDisplay
                  points={totalPoints}
                  creditKind="exchange"
                  unitDisplay="icon"
                  numberClassName="text-[17px] font-bold text-zinc-900"
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {detail.cartContext?.euroTotalPaid != null && detail.cartContext.euroTotalPaid > 0 ? (
          <section className="border-b border-zinc-200 py-4">
            <h2 className={cn("mb-4 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              Frais facturés
            </h2>
            <div className="space-y-2.5 text-[15px] leading-snug">
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Complément payé (TTC)</span>
                <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                  {formatEuros(detail.cartContext.euroTotalPaid)}
                </span>
              </div>
              <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-4">
                <span className="text-[17px] font-bold text-zinc-900">Sous-total facturé</span>
                <span className="text-[18px] font-bold tabular-nums text-zinc-900">
                  {formatEuros(detail.cartContext.euroTotalPaid)}
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {commandeHref && orderNumberCompact ? (
          <section className="border-b border-zinc-200 py-4">
            <Link
              href={commandeHref}
              className="flex items-center justify-between gap-3 text-[15px] font-semibold text-zinc-950 transition active:opacity-70"
            >
              <span>Voir la commande {orderNumberCompact}</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" strokeWidth={2} />
            </Link>
          </section>
        ) : null}

        {detail.lendContext ? (
          <section className={cn(commandeHref ? "py-4" : "border-b border-zinc-200 py-4")}>
            <Link
              href={detail.lendContext.itemHref}
              className="flex items-center justify-between gap-3 text-[15px] font-semibold text-zinc-950 transition active:opacity-70"
            >
              <span>Voir la pièce</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" strokeWidth={2} />
            </Link>
          </section>
        ) : null}

        {loading ? <p className="pt-4 text-center text-sm text-zinc-500">Mise à jour…</p> : null}
      </div>
    </main>
  );
}
