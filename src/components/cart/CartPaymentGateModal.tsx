"use client";

import Link from "next/link";
import { useEffect } from "react";

import { segnaDialogBodyClass, segnaDialogTitleClass, SEGNA_DIALOG_SHEET_CLASS } from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

const PROFILE_COMPLETE_HREF = "/profile/complete?tab=me";
const KYC_HREF = "/profile/kyc?tab=me";

type CartPaymentGateModalProps = {
  open: boolean;
  onClose: () => void;
  profileComplete: boolean;
  kycVerified: boolean;
};

export function CartPaymentGateModal({
  open,
  onClose,
  profileComplete,
  kycVerified,
}: CartPaymentGateModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const needsProfile = !profileComplete;
  const needsKyc = !kycVerified;

  const body =
    needsProfile && needsKyc
      ? "Pour payer ta commande, ajoute une photo de profil, renseigne tes infos essentielles (comme à l’onboarding) et valide ton identité (KYC)."
      : needsProfile
        ? "Pour payer ta commande, ajoute une photo de profil et renseigne tes infos essentielles (prénom, âge, ville, profession, tailles). Pas besoin d’atteindre 100 %."
        : "Pour payer ta commande, valide d’abord ton identité (KYC).";

  const primaryHref = needsProfile ? PROFILE_COMPLETE_HREF : KYC_HREF;
  const primaryLabel = needsProfile ? "Compléter mon profil" : "Faire ma vérification";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        id="cart-payment-gate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-payment-gate-modal-title"
        className={SEGNA_DIALOG_SHEET_CLASS}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />
        <h2 id="cart-payment-gate-modal-title" className={segnaDialogTitleClass()}>
          Paiement indisponible
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-3")}>{body}</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href={primaryHref}
            onClick={onClose}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
          >
            {primaryLabel}
          </Link>
          {needsProfile && needsKyc ? (
            <Link
              href={KYC_HREF}
              onClick={onClose}
              className="flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900 transition hover:bg-zinc-50"
            >
              Faire ma vérification
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-full items-center justify-center text-[14px] font-semibold text-zinc-500"
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
