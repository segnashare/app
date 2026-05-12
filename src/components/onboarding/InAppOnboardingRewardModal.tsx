"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type InAppOnboardingRewardModalProps = {
  userId: string;
};

export function InAppOnboardingRewardModal({ userId }: InAppOnboardingRewardModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const finishOnboarding = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from("users")
      .update({ onboarding_process: "finished" })
      .eq("id", userId)
      .eq("onboarding_process", "reward");
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setOpen(false);
    router.push("/exchange");
    router.refresh();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-2xl backdrop-saturate-75"
      role="presentation"
    >
      <div
        className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="in-app-onboarding-reward-title"
      >
        <SegnaDialogDismissButton
          variant="overlay"
          onClick={() => void finishOnboarding()}
          className={busy ? "pointer-events-none opacity-40" : undefined}
          aria-label="Fermer"
        />
        <h2 id="in-app-onboarding-reward-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
          Onboarding terminé&nbsp;!
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-3 font-medium text-zinc-800")}>
          Tu as vu l’essentiel de Segna. Ta première pièce est en analyse, passe maintenant à l’échange.
        </p>
        {error ? <p className={cn(segnaDialogMontserrat.className, "mt-3 text-sm text-red-600")}>{error}</p> : null}
        <div className={cn(segnaDialogMontserrat.className, "mt-5 flex flex-col gap-2")}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void finishOnboarding()}
            className="w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
          >
            Passer à l’échange
          </button>
        </div>
      </div>
    </div>
  );
}
