"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { InAppOnboardingStackSheetFrame } from "@/components/onboarding/InAppOnboardingStackSheetFrame";
import { segnaDialogBodyClass, segnaDialogMontserrat } from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

export function InAppOnboardingKycSheet() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const openKycVerification = () => {
    if (busy) return;
    setBusy(true);
    router.push("/profile/kyc?tab=me");
  };

  return (
    <InAppOnboardingStackSheetFrame
      sheetKind="kyc"
      titleId="in-app-onboarding-kyc-title"
      title="Vérifie ton identité"
      body={
        <p className={cn(segnaDialogBodyClass(), "mt-1.5 text-[14px] font-medium text-zinc-600")}>
          Lance la vérification pour sécuriser ton profil et débloquer tes premiers échanges.
        </p>
      }
      actions={
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
      }
    />
  );
}
