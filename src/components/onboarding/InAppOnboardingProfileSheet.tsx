"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  SEGNA_DIALOG_SHEET_CLASS,
  segnaDialogBodyClass,
  segnaDialogMontserrat,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type InAppOnboardingProfileSheetProps = {
  initiallyVisible: boolean;
};

export function InAppOnboardingProfileSheet({ initiallyVisible }: InAppOnboardingProfileSheetProps) {
  const router = useRouter();
  const [visible, setVisible] = useState(initiallyVisible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  const markDoneAndNavigate = async () => {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) {
      setBusy(false);
      setError("Session introuvable.");
      return;
    }
    const { error: upErr } = await supabase.from("users").update({ onboarding_process: "kyc" }).eq("id", uid);
    setBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setVisible(false);
    router.push("/profile/edit");
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/40 p-0"
      role="presentation"
    >
      <div
        className={cn(SEGNA_DIALOG_SHEET_CLASS, "mx-auto w-full max-w-[430px] rounded-b-none")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="in-app-onboarding-profile-title"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-zinc-300" aria-hidden />
        <h2 id="in-app-onboarding-profile-title" className={segnaDialogTitleClass()}>
          Complète ton profil
        </h2>
        <p className={cn(segnaDialogBodyClass(), "mt-2")}>
          Une photo et quelques infos aident la communauté à te faire confiance pour les échanges.
        </p>
        {error ? <p className={cn(segnaDialogMontserrat.className, "mt-2 text-sm text-red-600")}>{error}</p> : null}
        <div className={cn(segnaDialogMontserrat.className, "mt-5 flex flex-col gap-2")}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void markDoneAndNavigate()}
            className="w-full rounded-full bg-zinc-900 py-3.5 text-[15px] font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
          >
            Modifier mon profil
          </button>
        </div>
      </div>
    </div>
  );
}
