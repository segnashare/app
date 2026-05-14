"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SEGNA_DIALOG_CARD_CLASS,
  SegnaDialogDismissButton,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { buildReferralInviteUrl } from "@/components/community/referralShareMessage";
import { shareReferralInviteNative } from "@/components/community/referralShareNative";
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
  const [origin, setOrigin] = useState("");
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLoaded, setReferralLoaded] = useState(false);

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.from("referrals_codes").select("code").eq("user_id", userId).maybeSingle();
      if (!cancelled) {
        setReferralCode(typeof data?.code === "string" && data.code.trim() ? data.code.trim() : null);
        setReferralLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const inviteUrl = useMemo(() => {
    if (!origin) return "";
    return buildReferralInviteUrl(origin, referralCode);
  }, [origin, referralCode]);

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

        {origin && referralLoaded && inviteUrl ? (
          <div className={cn(segnaDialogMontserrat.className, "mt-4 rounded-xl border border-zinc-200 bg-zinc-50/90 px-3 py-3")}>
            <p className="text-[13px] font-semibold leading-snug text-zinc-800">
              Invite une amie : partage le lien (ton code est dedans) ou ouvre le partage système.
            </p>
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex max-w-full break-all text-[13px] font-semibold text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:text-zinc-700"
            >
              {inviteUrl}
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void shareReferralInviteNative(referralCode)}
              className="mt-3 w-full rounded-full bg-black py-3 text-[15px] font-bold text-white transition hover:bg-zinc-900 disabled:opacity-60"
            >
              Inviter une amie
            </button>
          </div>
        ) : null}

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
