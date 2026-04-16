"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { MemberCartOrderCancellation } from "@/lib/cart/fetch-member-cart-order-detail";

function reasonHint(reason: MemberCartOrderCancellation["disabledReason"]): string | null {
  switch (reason) {
    case "canceled":
      return "Cette commande a déjà été annulée.";
    case "archived":
      return "Cette commande est archivée et ne peut plus être annulée.";
    case "stripe_paid":
      return "Un paiement carte a été enregistré : l’annulation en ligne n’est pas disponible. Contacte le support Segna.";
    case "shipment_started":
      return "L’expédition a quitté le statut « en préparation » : annulation impossible depuis l’app.";
    default:
      return null;
  }
}

type Props = {
  cartId: string;
  cancellation: MemberCartOrderCancellation;
  /** Classes du conteneur du lien (ex. espacement sous « En préparation »). */
  wrapClassName?: string;
};

export function CommandeCancelOrderButton({ cartId, cancellation, wrapClassName }: Props) {
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
          Annuler la commande
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
              Tes crédits seront recrédités sur ton wallet et les pièces remises en vente.
            </p>
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
