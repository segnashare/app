"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

type InAppOnboardingKycSheetProps = {
  initiallyVisible: boolean;
};

export function InAppOnboardingKycSheet({ initiallyVisible }: InAppOnboardingKycSheetProps) {
  const router = useRouter();
  const [visible, setVisible] = useState(initiallyVisible);
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  const openKycVerification = () => {
    if (busy) return;
    setBusy(true);
    setVisible(false);
    router.push("/profile/kyc?tab=me");
  };

  return (
    <div
      className="relative rounded-2xl border border-zinc-300/90 bg-zinc-50/90 p-4 shadow-[0_8px_30px_rgba(24,24,27,0.08)] backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-labelledby="in-app-onboarding-kyc-title"
    >
      <div className="min-w-0">
        <h2 id="in-app-onboarding-kyc-title" className={segnaDialogTitleClass()}>
          Vérifie ton identité
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-1.5 text-[14px] font-medium text-zinc-600")}>
          Lance la vérification pour sécuriser ton profil et débloquer tes premiers échanges.
        </p>
      </div>
      <div className={cn(segnaDialogMontserrat.className, "mt-3 flex flex-col gap-2")}>
        <button
          type="button"
          disabled={busy}
          onClick={openKycVerification}
          className="flex w-full items-center justify-center rounded-full bg-zinc-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-900 disabled:opacity-60"
        >
          Faire ma vérification
        </button>
      </div>
    </div>
  );
}
