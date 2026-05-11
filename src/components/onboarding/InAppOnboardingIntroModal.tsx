"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isIntroSnoozedForAuthSession,
  writeIntroSnoozeForAuthSession,
} from "@/lib/onboarding/in-app-onboarding";
import { cn } from "@/lib/utils/cn";

type InAppOnboardingIntroModalProps = {
  userId: string;
  lastSignInAt: string | null;
};

export function InAppOnboardingIntroModal({ userId, lastSignInAt }: InAppOnboardingIntroModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const snoozed = isIntroSnoozedForAuthSession(
      typeof window !== "undefined" ? window.sessionStorage : null,
      userId,
      lastSignInAt,
    );
    setOpen(!snoozed);
  }, [mounted, userId, lastSignInAt]);

  if (!mounted || !open) return null;

  const dismissIntroForSession = () => {
    setBusy(true);
    setError(null);
    try {
      writeIntroSnoozeForAuthSession(window.sessionStorage, userId, lastSignInAt);
    } catch {
      setError("Impossible d’enregistrer ta préférence.");
      setBusy(false);
      return;
    }
    setOpen(false);
    setBusy(false);
    router.refresh();
  };

  const goToProfileStep = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      setError("Session introuvable.");
      return;
    }
    const { error: upErr } = await supabase
      .from("users")
      .update({ onboarding_process: "profile" })
      .eq("id", user.id);
    setBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setOpen(false);
    router.push("/exchange");
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
    >
      <div
        className={cn(SEGNA_DIALOG_CARD_CLASS, "relative")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="in-app-onboarding-intro-title"
      >
        <SegnaDialogDismissButton
          variant="overlay"
          onClick={() => {
            if (busy) return;
            dismissIntroForSession();
          }}
          className={busy ? "pointer-events-none opacity-40" : undefined}
          aria-label="Fermer pour plus tard"
        />
        <h2 id="in-app-onboarding-intro-title" className={cn(segnaDialogTitleClass(), "pr-10")}>
          Bienvenue sur Segna
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-3")}>
          Tu peux explorer le catalogue et l’app. Quand tu es prêt·e, poursuis la mise en route en deux petites
          étapes.
        </p>
        {error ? <p className={cn(segnaDialogMontserrat.className, "mt-3 text-sm text-red-600")}>{error}</p> : null}
        <div className={cn(segnaDialogMontserrat.className, "mt-5 flex flex-col gap-2")}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void goToProfileStep()}
            className="w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
          >
            Continuer
          </button>
        </div>
      </div>
    </div>
  );
}
