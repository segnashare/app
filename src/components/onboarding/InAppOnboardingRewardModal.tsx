"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { cn } from "@/lib/utils/cn";

export function InAppOnboardingRewardModal() {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const finishOnboarding = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/finish-reward", { method: "POST", credentials: "same-origin" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(typeof json.error === "string" && json.error.trim() ? json.error : "Impossible de finaliser pour l’instant.");
        return;
      }
      setOpen(false);
      router.push("/exchange");
      router.refresh();
    } catch {
      setError("Réseau indisponible. Réessaie.");
    } finally {
      setBusy(false);
    }
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
