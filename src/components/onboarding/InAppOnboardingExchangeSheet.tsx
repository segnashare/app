"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { InAppOnboardingStackSheetFrame } from "@/components/onboarding/InAppOnboardingStackSheetFrame";
import { segnaDialogBodyClass, segnaDialogMontserrat } from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

export function InAppOnboardingExchangeSheet() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const openItemProposal = () => {
    if (busy) return;
    setBusy(true);
    router.push("/items/new?fresh=1");
  };

  return (
    <InAppOnboardingStackSheetFrame
      sheetKind="exchange"
      titleId="in-app-onboarding-exchange-title"
      title="Échanger"
      body={
        <p className={cn(segnaDialogBodyClass(), "mt-1.5 text-[14px] font-medium text-zinc-600")}>
          Propose une pièce pour la faire entrer dans la collection et gagner des crédits d’échange.
        </p>
      }
      actions={
        <div className={cn(segnaDialogMontserrat.className, "mt-3 flex flex-col gap-2")}>
          <button
            type="button"
            disabled={busy}
            onClick={openItemProposal}
            className="flex w-full items-center justify-center rounded-full bg-zinc-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-900 disabled:opacity-60"
          >
            Prêter une pièce
          </button>
        </div>
      }
    />
  );
}
