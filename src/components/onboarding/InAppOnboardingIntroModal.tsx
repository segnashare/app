"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useState } from "react";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import type { ReferralInviteIntroKind } from "@/lib/auth/current-user-server";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isIntroSnoozedForAuthSession,
  writeIntroSnoozeForAuthSession,
} from "@/lib/onboarding/in-app-onboarding";
import { cn } from "@/lib/utils/cn";

type InAppOnboardingIntroModalProps = {
  userId: string;
  lastSignInAt: string | null;
  /** Parrainage : crédits visibles seulement une fois `qualified` ; `pending` = code capturé, avant validation. */
  referralInvite?: ReferralInviteIntroKind;
};

export function InAppOnboardingIntroModal({
  userId,
  lastSignInAt,
  referralInvite = "none",
}: InAppOnboardingIntroModalProps) {
  const router = useRouter();
  /** null = pas encore lu le sessionStorage (évite flash + double effet useEffect). */
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const snoozed = isIntroSnoozedForAuthSession(window.sessionStorage, userId, lastSignInAt);
    setOpen(!snoozed);
  }, [userId, lastSignInAt]);

  if (open !== true) return null;

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
          Bienvenue sur Segna&nbsp;!
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-3 font-medium text-zinc-800")}>
          Découvre notre collection et commence à échanger tes premières pièces&nbsp;!
        </p>
        {referralInvite === "qualified" ? (
          <div className="referral-intro-silver-outer mt-3">
            <div
              className={cn(
                segnaDialogMontserrat.className,
                "referral-intro-silver-inner overflow-hidden bg-zinc-50 px-3.5 py-3.5 text-center text-[15px] font-medium leading-snug text-zinc-800",
              )}
            >
              <p>
                Tu es arrivée ici grâce à <strong className="font-bold text-zinc-900">une amie Segna</strong>.
                Bienvenue dans le <strong className="font-bold text-zinc-900">dressing partagé</strong>&nbsp;!
              </p>
            </div>
          </div>
        ) : referralInvite === "pending" ? (
          <div className="referral-intro-silver-outer mt-3">
            <div
              className={cn(
                segnaDialogMontserrat.className,
                "referral-intro-silver-inner overflow-hidden bg-zinc-50 px-3.5 py-3.5 text-center text-[15px] font-medium leading-snug text-zinc-800",
              )}
            >
              <p>
                Tu es arrivée grâce au <strong className="font-bold text-zinc-900">parrainage Segna</strong>. Une fois
                ton <strong className="font-bold text-zinc-900">numéro vérifié</strong> et ton{" "}
                <strong className="font-bold text-zinc-900">parcours d’accueil terminé</strong>, ton compte sera lié à
                ton amie parrain.
              </p>
            </div>
          </div>
        ) : null}
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
