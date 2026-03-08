"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type PrivacyChoice = "accept" | "customize";
type PrivacyPreferences = {
  audience: boolean;
  personalization: boolean;
  socialFeatures: boolean;
};

type OnboardingPrivacyCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "700",
});

export function OnboardingPrivacyCore({ formId, onCanContinueChange }: OnboardingPrivacyCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [choice, setChoice] = useState<PrivacyChoice | null>(null);
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const [preferencesDraft, setPreferencesDraft] = useState<PrivacyPreferences>({
    audience: true,
    personalization: true,
    socialFeatures: true,
  });
  const [savedPreferences, setSavedPreferences] = useState<PrivacyPreferences | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canContinue = Boolean(choice) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!choice) {
      setErrorMessage("Choisis une option pour continuer.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/3",
      p_progress: {
        checkpoint: "/onboarding/privacy",
        privacy_value: choice,
        privacy_preferences: choice === "customize" ? savedPreferences : null,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/3");
  };

  return (
    <div className="mt-7 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-8">
        <p className={cn(montserrat.className, "max-w-[96%] text-[clamp(16px,3vw,20px)] font-medium leading-[1.08] text-zinc-950")}>
          Nous utilisons des outils pour mesurer l&apos;audience et l&apos;utilisation de Segna, personnaliser ton expérience, améliorer
          l&apos;application, activer les fonctionnalités sociales et mieux comprendre comment nos services sont utilisés dans leur ensemble.
          Ces outils ne suivent pas ton activité sur les applications et les sites Web.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setChoice("accept")}
            className={cn(
              montserrat.className,
              "rounded-[14px] px-4 py-2 text-[clamp(14px,3vw,22px)] leading-none",
              choice === "accept" ? "bg-[#5E3023] text-white" : "bg-zinc-200 text-zinc-900",
            )}
          >
            J&apos;accepte
          </button>
          <button
            type="button"
            onClick={() => setShowPreferencesModal(true)}
            className={cn(
              montserrat.className,
              "rounded-[14px] px-4 py-2 text-[clamp(14px,3vw,22px)] leading-none",
              choice === "customize" ? "bg-[#5E3023] text-white" : "bg-zinc-200 text-zinc-900",
            )}
          >
            Personnaliser mes choix
          </button>
        </div>
      </form>

      {showPreferencesModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-[540px] overflow-hidden rounded-2xl bg-white shadow-[0_16px_46px_rgba(0,0,0,0.28)]">
            <div className="px-5 pb-4 pt-5">
              <p className={cn(montserrat.className, "mb-4 text-[20px] font-semibold text-zinc-900")}>Personnaliser mes choix</p>
              <p className={cn(montserrat.className, "mb-4 text-[13px] leading-[1.25] text-zinc-600")}>
                Tu peux activer ou désactiver chaque catégorie. Ces réglages sont modifiables à tout moment.
              </p>

              <div className="space-y-3">
                <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-3">
                  <div className="pr-3">
                    <p className={cn(montserrat.className, "text-[15px] font-semibold leading-none text-zinc-900")}>Mesure d&apos;audience</p>
                    <p className="mt-1 text-[12px] leading-[1.25] text-zinc-500">Comprendre comment l&apos;app est utilisée.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferencesDraft.audience}
                    onChange={(event) =>
                      setPreferencesDraft((prev) => ({
                        ...prev,
                        audience: event.target.checked,
                      }))
                    }
                    className="h-5 w-5 accent-[#5E3023]"
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-3">
                  <div className="pr-3">
                    <p className={cn(montserrat.className, "text-[15px] font-semibold leading-none text-zinc-900")}>Personnalisation</p>
                    <p className="mt-1 text-[12px] leading-[1.25] text-zinc-500">Adapter ton expérience à ton profil.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferencesDraft.personalization}
                    onChange={(event) =>
                      setPreferencesDraft((prev) => ({
                        ...prev,
                        personalization: event.target.checked,
                      }))
                    }
                    className="h-5 w-5 accent-[#5E3023]"
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-3">
                  <div className="pr-3">
                    <p className={cn(montserrat.className, "text-[15px] font-semibold leading-none text-zinc-900")}>Fonctionnalités sociales</p>
                    <p className="mt-1 text-[12px] leading-[1.25] text-zinc-500">Activer les interactions communautaires.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferencesDraft.socialFeatures}
                    onChange={(event) =>
                      setPreferencesDraft((prev) => ({
                        ...prev,
                        socialFeatures: event.target.checked,
                      }))
                    }
                    className="h-5 w-5 accent-[#5E3023]"
                  />
                </label>
              </div>
            </div>

            <div className="flex h-[72px] border-t border-zinc-200">
              <button
                type="button"
                className={cn(montserrat.className, "h-full flex-1 text-[16px] font-medium text-zinc-700")}
                onClick={() => setShowPreferencesModal(false)}
              >
                Annuler
              </button>
              <div className="w-px bg-zinc-200" aria-hidden />
              <button
                type="button"
                className={cn(montserrat.className, "h-full flex-1 text-[16px] font-semibold text-[#5E3023]")}
                onClick={() => {
                  setSavedPreferences(preferencesDraft);
                  setChoice("customize");
                  setShowPreferencesModal(false);
                }}
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
