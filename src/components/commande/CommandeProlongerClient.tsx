"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Minus, Plus, X } from "lucide-react";

import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import type { MemberCartOrderLine } from "@/lib/cart/fetch-member-cart-order-detail";
import {
  BORROW_EXTENSION_MAX_DAYS,
  BORROW_EXTENSION_MIN_DAYS,
  BORROW_EXTENSION_EURO_PER_CREDIT_DAY_LABEL,
  clampBorrowExtensionDays,
  computeBorrowExtensionAmountCents,
  computeBorrowExtensionCreditsForCart,
  formatBorrowExtensionEuroTtc,
} from "@/lib/cart/borrow-extension-pricing";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
import { segnaDialogBodyClass } from "@/components/ui/SegnaAppDialog";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

/** Encarts info — même esprit que les popups / feuilles Segna (fond blanc, bordure noire). */
const PROLONGER_CALLOUT_CLASS = cn(
  "mx-5 mt-4 rounded-2xl border border-black bg-white px-4 py-3.5 shadow-sm",
  segnaDialogBodyClass(),
);

type CommandeProlongerClientProps = {
  cartId: string;
  orderNumberCompact: string;
  lines: MemberCartOrderLine[];
  creditKind: WalletCreditKind;
  existingExtensionDays: number;
};

export function CommandeProlongerClient({
  cartId,
  orderNumberCompact,
  lines,
  creditKind,
  existingExtensionDays,
}: CommandeProlongerClientProps) {
  const searchParams = useSearchParams();
  const extensionStatus = searchParams.get("extension");

  const [extensionDays, setExtensionDays] = useState(BORROW_EXTENSION_MIN_DAYS);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const creditsTotal = useMemo(() => computeBorrowExtensionCreditsForCart(lines), [lines]);
  const amountCents = useMemo(
    () => computeBorrowExtensionAmountCents(creditsTotal, extensionDays),
    [creditsTotal, extensionDays],
  );

  const canPay = creditsTotal > 0 && amountCents > 0 && !checkoutBusy;

  async function handlePay() {
    if (!canPay) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/stripe/cart-extension/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cartId,
          extensionDays: clampBorrowExtensionDays(extensionDays),
        }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;
      if (!res.ok || !data?.url) {
        setCheckoutError(data?.message ?? "Impossible de lancer le paiement.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setCheckoutError("Impossible de lancer le paiement.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white pb-[max(7.5rem,env(safe-area-inset-bottom,0px)+6.5rem)]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <Link
            href={`/exchange/emprunt/${cartId}`}
            className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900 transition hover:bg-zinc-100"
            aria-label="Fermer"
          >
            <X className="h-8 w-8" strokeWidth={2.25} />
          </Link>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Prolonger l&apos;échange
          </h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">Commande {orderNumberCompact}</p>
        </div>
      </header>

      {extensionStatus === "success" ? (
        <p className={PROLONGER_CALLOUT_CLASS} role="status">
          <span className="font-semibold text-zinc-900">Prolongation enregistrée</span> — ton échéance de retour a été
          mise à jour.
        </p>
      ) : null}
      {extensionStatus === "cancelled" ? (
        <p className={PROLONGER_CALLOUT_CLASS} role="status">
          Paiement annulé. Tu peux réessayer quand tu veux.
        </p>
      ) : null}
      {extensionStatus === "error" ? (
        <ProlongerExtensionErrorBanner reason={searchParams.get("reason")} />
      ) : null}

      {existingExtensionDays > 0 ? (
        <p className={PROLONGER_CALLOUT_CLASS} role="status">
          Tu as déjà prolongé cet emprunt de{" "}
          <span className="font-semibold text-zinc-900">
            {existingExtensionDays} jour{existingExtensionDays > 1 ? "s" : ""}
          </span>
          . Les jours ci-dessous s&apos;ajoutent à ton échéance actuelle.
        </p>
      ) : null}

      <section className="px-5 pb-2 pt-6">
        <h2 className={cn("min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
          Durée de prolongation
        </h2>
        <p className="mt-1.5 text-[15px] leading-snug text-zinc-600">
          {BORROW_EXTENSION_EURO_PER_CREDIT_DAY_LABEL}&nbsp;€ par crédit et par jour pour{" "}
          <span className="font-semibold text-zinc-800">tout le panier</span>.
        </p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setExtensionDays((d) => clampBorrowExtensionDays(d - 1))}
            disabled={extensionDays <= BORROW_EXTENSION_MIN_DAYS}
            aria-label="Réduire la durée"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-300 text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-40"
          >
            <Minus className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <div className="min-w-[8rem] text-center">
            <p className="text-[42px] font-bold tabular-nums leading-none text-zinc-900">{extensionDays}</p>
            <p className="mt-1 text-[15px] font-medium text-zinc-600">
              jour{extensionDays > 1 ? "s" : ""} de prolongation
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExtensionDays((d) => clampBorrowExtensionDays(d + 1))}
            disabled={extensionDays >= BORROW_EXTENSION_MAX_DAYS}
            aria-label="Augmenter la durée"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-300 text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-40"
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
      </section>

      <section className="border-t border-zinc-200 px-5 pb-4 pt-5">
        <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
          Contenu du panier
        </h2>
        {lines.length === 0 ? (
          <p className="text-sm text-zinc-500">Aucun article.</p>
        ) : (
          <CommandeOrderLineRows lines={lines} creditKind={creditKind} itemHrefSuffix="" pointsUnitDisplay="icon" />
        )}
      </section>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-4">
        <div className="mx-auto w-full max-w-lg">
          <p className="text-center text-[14px] text-zinc-600">
            <span className="font-semibold tabular-nums text-zinc-900">{creditsTotal}</span> crédit
            {creditsTotal > 1 ? "s" : ""} ×{" "}
            <span className="font-semibold tabular-nums text-zinc-900">{extensionDays}</span> jour
            {extensionDays > 1 ? "s" : ""} × {BORROW_EXTENSION_EURO_PER_CREDIT_DAY_LABEL}&nbsp;€
          </p>
          <p className="mt-1 text-center text-[22px] font-bold tabular-nums text-zinc-900">
            {formatBorrowExtensionEuroTtc(amountCents)}{" "}
            <span className="text-[13px] font-semibold text-zinc-500">TTC</span>
          </p>
          {checkoutError ? (
            <p className="mt-2 text-center text-[13px] text-red-600" role="alert">
              {checkoutError}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!canPay}
            onClick={() => void handlePay()}
            className="mt-3 flex h-[52px] w-full items-center justify-center rounded-xl bg-zinc-950 text-[16px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-50"
          >
            {checkoutBusy ? "Redirection vers Stripe…" : "Payer avec Stripe"}
          </button>
        </div>
      </footer>
    </main>
  );
}

function ProlongerExtensionErrorBanner({ reason }: { reason: string | null }) {
  if (reason === "migration_missing") {
    return (
      <p className={PROLONGER_CALLOUT_CLASS} role="alert">
        Le paiement Stripe a bien été reçu, mais la base n&apos;est pas à jour (table{" "}
        <span className="font-mono text-[12px] text-zinc-800">cart_borrow_extensions</span>). Applique la migration
        Supabase puis contacte le support avec l&apos;ID de session Stripe pour valider ta prolongation manuellement si
        besoin.
      </p>
    );
  }
  if (reason === "already_applied") {
    return (
      <p className={PROLONGER_CALLOUT_CLASS} role="status">
        Cette prolongation est déjà enregistrée — ton échéance devrait être à jour.
      </p>
    );
  }
  return (
    <p className={PROLONGER_CALLOUT_CLASS} role="alert">
      Le paiement n&apos;a pas pu être enregistré dans l&apos;app
      {reason ? (
        <>
          {" "}
          (<span className="font-mono text-[12px] text-zinc-800">{reason}</span>)
        </>
      ) : null}
      . Réessaie ou contacte le support avec l&apos;ID de ta commande.
    </p>
  );
}
