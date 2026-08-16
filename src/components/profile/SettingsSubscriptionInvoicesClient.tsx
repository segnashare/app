"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmpruntRentalProgressBar } from "@/components/emprunt/EmpruntRentalProgressBar";
import { formatDateParis, formatLongDateParis } from "@/lib/datetime/segna-datetime";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type InvoiceRow = {
  id: string;
  number: string | null;
  amount_paid: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

type Props = {
  returnPath: string;
};

function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: currency.toUpperCase() || "EUR",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} €`;
  }
}

export function SettingsSubscriptionInvoicesClient({ returnPath }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [periodStart, setPeriodStart] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stripe/subscription/invoices");
        const payload = (await res.json().catch(() => null)) as {
          ok?: boolean;
          invoices?: InvoiceRow[];
          subscription?: {
            current_period_start?: string | null;
            current_period_end?: string | null;
            cancel_at_period_end?: boolean;
          } | null;
          error?: string;
        } | null;
        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error ?? "Impossible de charger les factures.");
        }
        if (cancelled) return;
        setInvoices(payload.invoices ?? []);
        setPeriodStart(payload.subscription?.current_period_start ?? null);
        setPeriodEnd(payload.subscription?.current_period_end ?? null);
        setCancelAtPeriodEnd(Boolean(payload.subscription?.cancel_at_period_end));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startMs = useMemo(
    () => (periodStart ? Date.parse(periodStart) : Number.NaN),
    [periodStart],
  );
  const dueMs = useMemo(() => (periodEnd ? Date.parse(periodEnd) : Number.NaN), [periodEnd]);
  const showProgress = Number.isFinite(startMs) && Number.isFinite(dueMs);

  return (
    <main className={cn(segnaMontserrat.className, "min-h-[100dvh] bg-white")}>
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <Link
          href={returnPath}
          aria-label="Retour"
          className="-ml-1.5 inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-900"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2} />
        </Link>
        <h1 className="text-center text-[20px] font-bold leading-tight text-zinc-900">Mes factures</h1>
        <span className="inline-block h-10 w-10" aria-hidden />
      </header>

      <section className="mx-auto w-full max-w-[460px] pb-10 pt-5">
        {showProgress ? (
          <div className="border-b border-zinc-100 px-5 pb-5">
            <p className="text-[15px] font-semibold text-zinc-900">
              {cancelAtPeriodEnd ? "Fin d’abonnement" : "Prochain paiement"}
            </p>
            <p className="mt-1 text-[13px] leading-snug text-zinc-500">
              {cancelAtPeriodEnd
                ? `Ton abonnement s’arrête le ${formatLongDateParis(periodEnd)}.`
                : `Renouvellement le ${formatLongDateParis(periodEnd)}.`}
            </p>
            <EmpruntRentalProgressBar startMs={startMs} dueMs={dueMs} />
            <p className="mt-2 text-[12px] text-zinc-400">
              Période du {formatDateParis(periodStart)} au {formatDateParis(periodEnd)}
            </p>
          </div>
        ) : null}

        {loading ? <p className="mt-6 px-5 text-sm text-zinc-500">Chargement…</p> : null}
        {error ? <p className="mt-6 px-5 text-sm text-red-600">{error}</p> : null}

        {!loading && !error ? (
          <div className="mt-2 divide-y divide-zinc-100 border-t border-zinc-100">
            {invoices.length === 0 ? (
              <p className="px-5 py-6 text-[14px] text-zinc-500">Aucune facture pour le moment.</p>
            ) : (
              invoices.map((inv) => {
                const href = inv.hosted_invoice_url || inv.invoice_pdf;
                const label = inv.number ? `Facture ${inv.number}` : `Facture du ${formatDateParis(inv.created * 1000)}`;
                const amount = formatAmount(inv.amount_paid, inv.currency);
                const content = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-medium text-zinc-900">{label}</p>
                      <p className="mt-0.5 text-[13px] text-zinc-500">
                        {formatDateParis(inv.created * 1000)} · {amount}
                      </p>
                    </div>
                    {href ? <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden /> : null}
                  </>
                );
                if (!href) {
                  return (
                    <div key={inv.id} className="flex min-h-[52px] items-center gap-3 px-5 py-3.5">
                      {content}
                    </div>
                  );
                }
                return (
                  <a
                    key={inv.id}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-[52px] items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50"
                  >
                    {content}
                  </a>
                );
              })
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
