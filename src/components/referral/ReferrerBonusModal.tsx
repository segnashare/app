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
import { cn } from "@/lib/utils/cn";

export type ReferrerBonusModalPayload = {
  referredDisplayName: string;
};

type ReferrerBonusModalProps = {
  payload: ReferrerBonusModalPayload;
};

export function ReferrerBonusModal({ payload }: ReferrerBonusModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/referral/dismiss-referrer-bonus-modal", {
        method: "POST",
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof json.error === "string" && json.error.trim() ? json.error : "Impossible de fermer pour l’instant.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Réseau indisponible. Réessaie.");
    } finally {
      setBusy(false);
    }
  };

  const name = payload.referredDisplayName.trim() || "Ton invitée";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-2xl backdrop-saturate-75"
      role="presentation"
    >
      <div
        className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="referrer-bonus-title"
      >
        <SegnaDialogDismissButton
          variant="overlay"
          onClick={() => void dismiss()}
          className={busy ? "pointer-events-none opacity-40" : undefined}
          aria-label="Fermer"
        />
        <h2 id="referrer-bonus-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
          Parrainage confirmé
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-3 font-medium text-zinc-800")}>
          <span className={cn(segnaDialogMontserrat.className, "font-semibold text-zinc-900")}>{name}</span> vient de
          rejoindre Segna grâce à ton parrainage. Tu viens de gagner{" "}
          <strong className="font-bold text-zinc-900">un échange inclus</strong> (livraison offerte)&nbsp;!
        </p>
        {error ? <p className={cn(segnaDialogMontserrat.className, "mt-3 text-sm text-red-600")}>{error}</p> : null}
        <div className={cn(segnaDialogMontserrat.className, "mt-5")}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void dismiss()}
            className="w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
          >
            Super, merci&nbsp;!
          </button>
        </div>
      </div>
    </div>
  );
}
