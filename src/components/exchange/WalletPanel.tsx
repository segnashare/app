"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { SegnaAppBottomSheet } from "@/components/ui/SegnaAppBottomSheet";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { WalletTransactionDetailView } from "@/components/exchange/WalletTransactionDetailView";
import { ExchangeOrderHelpSection } from "@/components/exchange/ExchangeOrderHelpSection";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import type { WalletTransactionDetail } from "@/lib/wallet/fetch-wallet-transaction-detail";
import type { WalletRecentTransaction } from "@/lib/wallet/wallet-transaction-display";
import {
  formatWalletTransactionListDetailLine,
  formatWalletTransactionWhen,
  walletTransactionBalanceAfter,
} from "@/lib/wallet/wallet-transaction-display";
import type { WalletOverview } from "@/lib/wallet/fetch-wallet-overview";
import { WALLET_BONUS_BUCKET_SHORT_LABEL } from "@/lib/wallet/credit-kind";
import { cn } from "@/lib/utils/cn";

type WalletPanelProps = {
  open: boolean;
  onClose: () => void;
  availablePoints: number;
  membershipLabel: string;
};

/** Proportions carte bancaire (~85,6 × 54 mm). */
const WALLET_CARD_ASPECT = "aspect-[1.586/1]";

const WALLET_COMPOSITION_HINT =
  "Les bonus complètent ton solde ; l'échange vient surtout des prêts.";

const WALLET_TX_ROW_CLASS =
  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-5 py-3 text-left transition active:bg-zinc-50";

function WalletCardChip({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-7 w-9 shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="wallet-card-chip" x1="0" y1="0" x2="36" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8DDB5" />
          <stop offset="0.45" stopColor="#C9B67A" />
          <stop offset="1" stopColor="#A89255" />
        </linearGradient>
      </defs>
      <rect width="36" height="28" rx="4" fill="url(#wallet-card-chip)" />
      <path d="M0 9.33H36M0 18.67H36M12 0V28M24 0V28" stroke="#8A7340" strokeOpacity="0.55" strokeWidth="0.75" />
    </svg>
  );
}

function WalletCardContactlessIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-6 w-6 shrink-0", className)}
      aria-hidden
    >
      <path
        d="M8.5 12.25C9.45 11.3 10.65 10.75 12 10.75C13.35 10.75 14.55 11.3 15.5 12.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M5.75 9.5C7.45 7.8 9.6 6.75 12 6.75C14.4 6.75 16.55 7.8 18.25 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M3 6.75C5.45 4.3 8.55 2.75 12 2.75C15.45 2.75 18.55 4.3 21 6.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WalletCardShell({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-[14px] bg-[#171717] shadow-[0_8px_24px_rgba(0,0,0,0.16)]",
        WALLET_CARD_ASPECT,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(255,255,255,0.08),transparent_42%),radial-gradient(circle_at_82%_78%,rgba(0,0,0,0.55),transparent_48%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-soft-light"
        style={{
          backgroundImage:
            "repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0.04) 0deg 2deg, transparent 2deg 4deg)",
        }}
        aria-hidden
      />
      {children}
    </div>
  );
}

function WalletCardFront({ balance }: { balance: number }) {
  return (
    <WalletCardShell>
      <div className="absolute left-5 top-1/2 flex -translate-y-1/2 items-center gap-3">
        <WalletCardChip />
        <WalletCardContactlessIcon className="rotate-90 text-white/70" />
      </div>

      <div className="absolute right-5 top-5 flex flex-col items-end gap-1.5">
        <SegnaPointsUnitDisplay
          points={balance}
          creditKind="exchange"
          unitDisplay="icon"
          className="justify-end gap-2"
          numberClassName="text-[34px] font-semibold leading-none tracking-tight text-white sm:text-[36px]"
          iconClassName="h-7 w-7 max-w-none brightness-0 invert"
        />
      </div>

      <div className="absolute bottom-5 right-5">
        <img
          src="/ressources/segna_logo.svg"
          alt="Segna"
          width={497}
          height={204}
          className="h-5 w-auto brightness-0 invert opacity-90"
          decoding="async"
        />
      </div>
    </WalletCardShell>
  );
}

function formatWalletIncomingSummary(overview: WalletOverview): string {
  const parts: string[] = [];
  if (overview.incoming.borrowReturnCredits > 0) parts.push("retour emprunt");
  if (overview.incoming.lendPayoutCredits > 0) parts.push("prêt Segna");
  const detail = parts.join(", ");
  return `+${overview.incoming.total.toLocaleString("fr-FR")} · ${detail}`;
}

function WalletCompositionBar({
  exchange,
  consumption,
}: {
  exchange: number;
  consumption: number;
}) {
  const total = Math.max(0, exchange) + Math.max(0, consumption);
  const exchangeShare = total > 0 ? (Math.max(0, exchange) / total) * 100 : 0;
  const consumptionShare = total > 0 ? (Math.max(0, consumption) / total) * 100 : 0;

  return (
    <>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-white/10"
        role="img"
        aria-label={`Répartition : ${exchange.toLocaleString("fr-FR")} échange, ${consumption.toLocaleString("fr-FR")} bonus`}
      >
        {exchange > 0 ? (
          <div className="h-full bg-white/90" style={{ width: `${exchangeShare}%` }} />
        ) : null}
        {consumption > 0 ? (
          <div className="h-full bg-white/35" style={{ width: `${consumptionShare}%` }} />
        ) : null}
      </div>
      <p className="mt-2 text-[12px] tabular-nums text-white/85">
        {exchange.toLocaleString("fr-FR")} échange · {consumption.toLocaleString("fr-FR")}{" "}
        {WALLET_BONUS_BUCKET_SHORT_LABEL.toLowerCase()}
      </p>
    </>
  );
}

function WalletCardAnalyticsBackSkeleton() {
  return (
    <div className="mt-auto w-full space-y-2.5" aria-hidden>
      <div className="h-2 w-full animate-pulse rounded-full bg-white/10" />
      <div className="h-3 w-[72%] animate-pulse rounded bg-white/10" />
      <div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" />
    </div>
  );
}

function WalletCardAnalyticsBack({
  overview,
  loading,
}: {
  overview: WalletOverview | null;
  loading: boolean;
}) {
  const hasIncoming = (overview?.incoming.total ?? 0) > 0;

  return (
    <WalletCardShell>
      <div className="absolute inset-0 flex flex-col overflow-hidden px-4 py-3.5">
        <div className="flex shrink-0 items-start justify-end">
          <img
            src="/ressources/segna_logo.svg"
            alt=""
            aria-hidden
            width={497}
            height={204}
            className="h-4 w-auto brightness-0 invert opacity-70"
            decoding="async"
          />
        </div>

        {loading && !overview ? (
          <WalletCardAnalyticsBackSkeleton />
        ) : overview ? (
          <div className="mt-auto w-full space-y-3">
            <WalletCompositionBar
              exchange={overview.available.exchange}
              consumption={overview.available.consumption}
            />
            <p className="text-[11px] leading-snug text-white/45">{WALLET_COMPOSITION_HINT}</p>

            {hasIncoming ? (
              <div className="space-y-2 border-t border-white/10 pt-3">
                <p className="text-[12px] font-medium tabular-nums text-emerald-400">
                  {formatWalletIncomingSummary(overview)}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] text-white/45" aria-hidden>
                    →
                  </span>
                  <SegnaPointsUnitDisplay
                    points={overview.projectedTotal}
                    creditKind="exchange"
                    unitDisplay="icon"
                    className="gap-1"
                    numberClassName="text-[16px] font-semibold leading-none tabular-nums text-white"
                    iconClassName="h-3.5 w-3.5 max-w-none brightness-0 invert opacity-90"
                  />
                  <span className="text-[11px] text-white/45">au total</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-auto text-[12px] text-white/50">Impossible de charger la vue wallet.</p>
        )}
      </div>
    </WalletCardShell>
  );
}

function WalletFlipCard({
  balance,
  overview,
  loadingOverview,
  flipped,
  onFlip,
}: {
  balance: number;
  overview: WalletOverview | null;
  loadingOverview: boolean;
  flipped: boolean;
  onFlip: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFlip}
      aria-expanded={flipped}
      aria-label={flipped ? "Retourner la carte wallet" : "Afficher la vue analytique du wallet"}
      className="block w-full [perspective:1200px] outline-none focus-visible:rounded-[14px] focus-visible:ring-2 focus-visible:ring-zinc-900/20"
    >
      <div
        className={cn(
          "relative w-full transition-transform duration-500 ease-in-out [transform-style:preserve-3d]",
          flipped && "[transform:rotateY(180deg)]",
        )}
      >
        <div className="w-full [backface-visibility:hidden]">
          <WalletCardFront balance={balance} />
        </div>
        <div className="absolute inset-0 w-full [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <WalletCardAnalyticsBack overview={overview} loading={loadingOverview} />
        </div>
      </div>
    </button>
  );
}

function WalletTransactionRow({
  tx,
  onOpen,
}: {
  tx: WalletRecentTransaction;
  onOpen: (txId: string) => void;
}) {
  const when = formatWalletTransactionWhen(tx.createdAt);
  const detailLine = formatWalletTransactionListDetailLine(tx.subtitle, when);
  const signedPrefix = tx.direction === "credit" ? "+" : "−";
  const balanceAfterPoints = walletTransactionBalanceAfter(
    tx.balanceBeforePoints,
    tx.direction,
    tx.amountPoints,
  );
  const balanceTrendClassName =
    tx.direction === "credit" ? "text-emerald-500" : "text-red-600";

  return (
    <button type="button" onClick={() => onOpen(tx.id)} className={WALLET_TX_ROW_CLASS}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="break-words text-[18px] font-semibold italic leading-[1.15] text-zinc-900">{tx.label}</p>
          {tx.isAdminAdjustment ? (
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Admin
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-1 min-w-0 text-[13px] leading-[1.3] text-zinc-500" title={detailLine}>
          {detailLine}
        </p>
        <p
          className={cn(
            "mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold tabular-nums",
            balanceTrendClassName,
          )}
          aria-label={`Solde avant ${tx.balanceBeforePoints}, solde après ${balanceAfterPoints}`}
        >
          <span>{tx.balanceBeforePoints}</span>
          <span aria-hidden>→</span>
          <span>{balanceAfterPoints}</span>
        </p>
      </div>

      <span className="inline-flex shrink-0 items-center gap-0.5 self-center">
        <span className="text-[15px] font-semibold tabular-nums text-zinc-900" aria-hidden>
          {signedPrefix}
        </span>
        <SegnaPointsUnitDisplay
          points={tx.amountPoints}
          creditKind="exchange"
          unitDisplay="icon"
          numberClassName="text-[15px] font-semibold tabular-nums text-zinc-900"
        />
      </span>
    </button>
  );
}

export function WalletPanel({ open, onClose, availablePoints }: WalletPanelProps) {
  const [transactions, setTransactions] = useState<WalletRecentTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WalletTransactionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedTxId(null);
      setDetail(null);
      setDetailError(null);
      setCardFlipped(false);
      return;
    }
    let cancelled = false;
    setLoadingTx(true);
    setLoadingOverview(true);
    void Promise.all([
      fetch("/api/wallet/recent-transactions").then(async (res) => {
        if (!res.ok) return { transactions: [] as WalletRecentTransaction[] };
        return (await res.json()) as { transactions?: WalletRecentTransaction[] };
      }),
      fetch("/api/wallet/overview").then(async (res) => {
        if (!res.ok) return { overview: null as WalletOverview | null };
        return (await res.json()) as { overview?: WalletOverview | null };
      }),
    ])
      .then(([txJson, overviewJson]) => {
        if (!cancelled) {
          setTransactions(txJson.transactions ?? []);
          setOverview(overviewJson.overview ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTransactions([]);
          setOverview(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingTx(false);
          setLoadingOverview(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!selectedTxId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    void fetch(`/api/wallet/transactions/${selectedTxId}`)
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          detail?: WalletTransactionDetail;
          message?: string;
        } | null;
        if (!res.ok) {
          throw new Error(json?.message ?? "Impossible de charger la transaction.");
        }
        return json?.detail ?? null;
      })
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setDetailError(error instanceof Error ? error.message : "Impossible de charger la transaction.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTxId]);

  const showDetail = selectedTxId != null;

  return (
    <SegnaAppBottomSheet
      open={open}
      onClose={onClose}
      labelledBy="wallet-panel-title"
      className={cn(
        "max-h-[92dvh] overflow-y-auto rounded-t-[28px]",
        showDetail ? "bg-white p-0" : "bg-white",
      )}
      overlayClassName="bg-black/35"
    >
      {showDetail ? (
        <>
          {loadingDetail && !detail ? (
            <div className="px-5 py-16 text-center text-sm text-zinc-500">Chargement…</div>
          ) : detail ? (
            <WalletTransactionDetailView detail={detail} loading={loadingDetail} onBack={() => setSelectedTxId(null)} />
          ) : (
            <div className="px-5 py-16 text-center">
              <p className="text-sm text-zinc-500">{detailError ?? "Transaction introuvable."}</p>
              <button
                type="button"
                onClick={() => setSelectedTxId(null)}
                className="mt-4 text-[15px] font-semibold text-zinc-900"
              >
                Retour
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="relative px-5 pb-8 pt-2">
          <div className="absolute left-0 top-0 flex min-h-10 items-center">
            <ExchangeOrderHelpSection placement="header" triggerLabel="Besoin d'aide ?" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-900 transition active:bg-zinc-100"
          >
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>

          <h2 id="wallet-panel-title" className="sr-only">
            Wallet Segna
          </h2>

          <div className="pt-10">
            <WalletFlipCard
              balance={overview?.available.total ?? availablePoints}
              overview={overview}
              loadingOverview={loadingOverview}
              flipped={cardFlipped}
              onFlip={() => setCardFlipped((value) => !value)}
            />
          </div>

          <section className="mt-8">
            <h3 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              Dernières transactions
            </h3>
            {loadingTx ? (
              <p className="py-8 text-sm text-zinc-500">Chargement…</p>
            ) : transactions.length === 0 ? (
              <p className="py-8 text-sm text-zinc-500">Aucune transaction pour le moment.</p>
            ) : (
              <div className="-mx-5 mt-3 divide-y-[1px] divide-zinc-200">
                {transactions.map((tx) => (
                  <WalletTransactionRow key={tx.id} tx={tx} onOpen={setSelectedTxId} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </SegnaAppBottomSheet>
  );
}
