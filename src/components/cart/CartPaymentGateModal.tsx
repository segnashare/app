"use client";

import Link from "next/link";

import { segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { SegnaAppBottomSheet, SegnaDialogSheetHandle } from "@/components/ui/SegnaAppBottomSheet";
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
    <SegnaAppBottomSheet
      open={open}
      onClose={onClose}
      dialogId="cart-payment-gate-modal"
      labelledBy="cart-payment-gate-modal-title"
      zIndexClassName="z-[100]"
    >
      <SegnaDialogSheetHandle />
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
    </SegnaAppBottomSheet>
  );
}
