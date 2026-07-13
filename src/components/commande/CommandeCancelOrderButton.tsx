"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  CART_ORDER_CANCEL_STRIPE_FEE_RATE,
  stripeCancelFeeBreakdownFromTotalCents,
} from "@/lib/cart/cart-order-cancel-stripe-fee";
import type { MemberCartOrderCancellation } from "@/lib/cart/fetch-member-cart-order-detail";

function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

/** Lignes € affichées uniquement dans la modale d’annulation. */
export type CommandeCancelStripeEuroLines = {
  complementCreditsEuros: number;
  serviceFeeEuros: number;
  shippingFeeEuros: number;
  totalPaidEuros: number;
  feesVatEuros?: number;
};

function reasonHint(reason: MemberCartOrderCancellation["disabledReason"]): string | null {
  switch (reason) {
    case "canceled":
      return "Cette commande a déjà été annulée.";
    case "archived":
      return "Cette commande est archivée et ne peut plus être annulée.";
    case "stripe_paid":
      return "Un paiement carte a été enregistré : l’annulation en ligne n’est pas disponible. Contacte le support Segna.";
    case "shipment_started":
      return "L’expédition a quitté la préparation ou le statut « prêt » : annulation impossible depuis l’app.";
    default:
      return null;
  }
}

type Props = {
  cartId: string;
  cancellation: MemberCartOrderCancellation;
  /** Détail € carte pour la modale (frais + pénalité 20 %) ; null si aucun paiement carte. */
  stripeEuroLines?: CommandeCancelStripeEuroLines | null;
  /** Classes du conteneur du lien (ex. espacement sous « En préparation »). */
  wrapClassName?: string;
};

export function CommandeCancelOrderButton({ cartId, cancellation, stripeEuroLines, wrapClassName }: Props) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const closeModal = useCallback(() => {
    if (!busy) setModalOpen(false);
  }, [busy]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, closeModal]);

  const stripeTotalCents =
    stripeEuroLines && stripeEuroLines.totalPaidEuros > 0.005
      ? Math.round(stripeEuroLines.totalPaidEuros * 100)
      : 0;
  const stripeFeePreview =
    stripeTotalCents > 0 ? stripeCancelFeeBreakdownFromTotalCents(stripeTotalCents) : null;

  if (!cancellation.canRequest) {
    const hint = reasonHint(cancellation.disabledReason);
    if (!hint) return null;
    return (
      <p className="pb-1 text-center text-[12px] leading-relaxed text-zinc-500" role="status">
        {hint}
      </p>
    );
  }

  async function confirmCancel() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/cart/order/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) {
        setErr(j.error ?? "Annulation impossible.");
        return;
      }
      setModalOpen(false);
      router.refresh();
    } catch {
      setErr("Erreur réseau. Réessaie.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className={
          wrapClassName ??
          "flex flex-col items-center gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-6"
        }
      >
        <button
          type="button"
          onClick={() => {
            setErr(null);
            setModalOpen(true);
          }}
          className="text-[15px] font-semibold text-red-600 underline-offset-2 transition hover:text-red-700 hover:underline"
        >
          Annuler
        </button>
        {err && !modalOpen ? (
          <p className="max-w-sm text-center text-[12px] text-red-600" role="alert">
            {err}
          </p>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Fermer"
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-order-dialog-title"
            className="relative z-[81] m-4 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 id="cancel-order-dialog-title" className="text-lg font-semibold text-zinc-900">
              Annuler cette commande ?
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
              Ta commande sera annulée et les pièces remises en vente.
            </p>
            {stripeEuroLines && stripeFeePreview ? (
              <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
                Sur le montant payé par carte, une retenue de{" "}
                <span className="font-semibold text-zinc-800">
                  {Math.round(CART_ORDER_CANCEL_STRIPE_FEE_RATE * 100)}&nbsp;%
                </span>{" "}
                est appliquée ; le solde est remboursé sur ton moyen de paiement.
              </p>
            ) : null}
            {stripeEuroLines && stripeFeePreview ? (
              <div className="mt-4 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/90 px-3 py-3 text-left text-[13px] leading-snug text-zinc-700">
                <p className="font-semibold text-zinc-900">Détail paiement carte (TTC)</p>
                {stripeEuroLines.complementCreditsEuros > 0.005 ? (
                  <div className="flex justify-between gap-2">
                    <span>Complément d&apos;échange</span>
                    <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                      {formatEuros(stripeEuroLines.complementCreditsEuros)}
                    </span>
                  </div>
                ) : null}
                {stripeEuroLines.serviceFeeEuros > 0.005 ? (
                  <div className="flex justify-between gap-2">
                    <span>Frais de service</span>
                    <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                      {formatEuros(stripeEuroLines.serviceFeeEuros)}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2">
                  <span>Frais de livraison</span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {formatEuros(stripeEuroLines.shippingFeeEuros)}
                  </span>
                </div>
                {stripeEuroLines.feesVatEuros != null && stripeEuroLines.feesVatEuros > 0.005 ? (
                  <div className="flex justify-between gap-2">
                    <span>dont TVA</span>
                    <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                      {formatEuros(stripeEuroLines.feesVatEuros)}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2 border-t border-zinc-200 pt-2 font-medium text-zinc-900">
                  <span>Total payé carte</span>
                  <span className="shrink-0 tabular-nums">{formatEuros(stripeEuroLines.totalPaidEuros)}</span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-600">
                  <span>Frais d&apos;annulation ({Math.round(CART_ORDER_CANCEL_STRIPE_FEE_RATE * 100)}&nbsp;%)</span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-800">
                    {formatEuros(stripeFeePreview.feeCents / 100)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-t border-zinc-200 pt-2 text-[14px] font-semibold text-zinc-900">
                  <span>Remboursement carte estimé</span>
                  <span className="shrink-0 tabular-nums">{formatEuros(stripeFeePreview.refundCents / 100)}</span>
                </div>
              </div>
            ) : null}
            {err ? (
              <p className="mt-3 text-[13px] text-red-600" role="alert">
                {err}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={busy}
                className="rounded-xl border border-zinc-200 py-3 text-[15px] font-medium text-zinc-800 transition enabled:hover:bg-zinc-50 disabled:opacity-50 sm:px-5"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                disabled={busy}
                className="rounded-xl bg-red-600 py-3 text-[15px] font-semibold text-white transition enabled:hover:bg-red-700 disabled:opacity-50 sm:px-5"
              >
                {busy ? "Annulation…" : "Confirmer l’annulation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
