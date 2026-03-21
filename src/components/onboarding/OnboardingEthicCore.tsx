"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Check } from "lucide-react";

import { StyleAdditionalInput } from "@/components/onboarding/StyleAdditionalInput";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type OnboardingEthicCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  redirectPath?: string;
};

const ETHIC_OPTIONS = [
  "Réduire ma consommation de vêtements neufs",
  "Allonger la vie de mes pièces préférées",
  "Honnêtement, je viens surtout pour le style (et c’est OK)",
] as const;

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingEthicCore({ formId, onCanContinueChange, redirectPath }: OnboardingEthicCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedEthicOptions, setSelectedEthicOptions] = useState<string[]>([]);
  const [customEthicText, setCustomEthicText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedCustomEthic = customEthicText.trim();
  const canContinue = (selectedEthicOptions.length > 0 || normalizedCustomEthic.length >= 4) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (selectedEthicOptions.length === 0 && normalizedCustomEthic.length < 4) {
      setErrorMessage("Choisis au moins une réponse ou ajoute ton texte.");
      return;
    }

    setIsSubmitting(true);
    const { error: profileError } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        preferences: {
          ethic: {
            value: selectedEthicOptions,
            custom_text: normalizedCustomEthic || null,
          },
        },
      },
      p_request_id: crypto.randomUUID(),
    });
    if (profileError) {
      setIsSubmitting(false);
      setErrorMessage(profileError.message);
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/privacy",
      p_progress_json: {
        checkpoint: "/onboarding/ethic",
      },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(redirectPath ?? "/onboarding/privacy");
  };

  return (
    <div className="mt-7 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate>
        <div className="space-y-0.5">
          {ETHIC_OPTIONS.map((option) => {
            const isSelected = selectedEthicOptions.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setSelectedEthicOptions((prev) => {
                    if (prev.includes(option)) return prev.filter((item) => item !== option);
                    return [...prev, option];
                  });
                }}
                className="flex w-full items-center justify-between border-b border-zinc-300 py-4 text-left"
                aria-pressed={isSelected}
              >
                <span className={cn(montserrat.className, "max-w-[84%] text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>{option}</span>
                <span
                  className={cn(
                    "ml-4 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center border",
                    isSelected ? "border-[#5E3023] bg-[#5E3023] text-white" : "border-zinc-300 bg-zinc-200 text-transparent",
                  )}
                  aria-hidden
                >
                  <Check size={15} strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          <StyleAdditionalInput
            value={customEthicText}
            onChange={setCustomEthicText}
            textareaRef={textareaRef}
            onAddClick={() => textareaRef.current?.focus()}
            placeholder="Raconte-nous ton rapport à la mode responsable"
            rows={2}
            containerClassName="pb-2 pt-2"
            textareaClassName="min-h-[30px]"
          />
        </div>
      </form>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
