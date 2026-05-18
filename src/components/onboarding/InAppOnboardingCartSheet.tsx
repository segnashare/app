"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { InAppOnboardingStackSheetFrame } from "@/components/onboarding/InAppOnboardingStackSheetFrame";
import { segnaDialogBodyClass, segnaDialogMontserrat } from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

export function InAppOnboardingCartSheet() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const openShop = () => {
    if (busy) return;
    setBusy(true);
    router.push("/shop");
  };

  return (
    <InAppOnboardingStackSheetFrame
      sheetKind="panier"
      titleId="in-app-onboarding-cart-title"
      title="Compose ton premier panier"
      body={
        <p className={cn(segnaDialogBodyClass(), "mt-1.5 text-[14px] font-medium text-zinc-600")}>
          Découvre le catalogue et ajoute tes premières pièces au panier pour lancer ton premier échange.
        </p>
      }
      actions={
        <div className={cn(segnaDialogMontserrat.className, "mt-3 flex flex-col gap-2")}>
          <button
            type="button"
            disabled={busy}
            onClick={openShop}
            className="flex w-full items-center justify-center rounded-full bg-zinc-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-900 disabled:opacity-60"
          >
            Voir le catalogue
          </button>
        </div>
      }
    />
  );
}
