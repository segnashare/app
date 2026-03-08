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

type OnboardingMotivationCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const MOTIVATION_OPTIONS = [
  "Alléger mon dressing et le rentabiliser.",
  "Trouver de l’inspiration dans le style des autres.",
  "Rencontrer une communauté qui partage ma vision de la mode.",
  "Je ne sais pas trop encore.",
] as const;
const UNSURE_OPTION = "Je ne sais pas trop encore.";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingMotivationCore({ formId, onCanContinueChange }: OnboardingMotivationCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedMotivations, setSelectedMotivations] = useState<string[]>([]);
  const [customMotivationText, setCustomMotivationText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedCustomMotivation = customMotivationText.trim();
  const canContinue = (selectedMotivations.length > 0 || normalizedCustomMotivation.length >= 4) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (selectedMotivations.length === 0 && normalizedCustomMotivation.length < 4) {
      setErrorMessage("Choisis au moins une motivation ou ajoute ton texte.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/experience",
      p_progress: {
        checkpoint: "/onboarding/motivation",
        motivation_value: selectedMotivations,
        motivation_custom_text: normalizedCustomMotivation || null,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/experience");
  };

  return (
    <div className="mt-7 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate>
        <div className="space-y-0.5">
          {MOTIVATION_OPTIONS.map((option) => {
            const isSelected = selectedMotivations.includes(option);
            const isUnsureOption = option === UNSURE_OPTION;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setSelectedMotivations((prev) => {
                    const alreadySelected = prev.includes(option);
                    if (alreadySelected) return prev.filter((item) => item !== option);

                    // "Je ne sais pas trop encore" is exclusive.
                    if (isUnsureOption) return [option];
                    return [...prev.filter((item) => item !== UNSURE_OPTION), option];
                  });
                }}
                className="flex w-full items-center justify-between border-b border-zinc-300 py-4 text-left"
                aria-pressed={isSelected}
              >
                <span className={cn(montserrat.className, "max-w-[84%] text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>{option}</span>
                {isUnsureOption ? (
                  <span
                    className={cn(
                      "ml-4 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border",
                      isSelected ? "border-[#5E3023] bg-[#5E3023] text-white" : "border-zinc-300 bg-zinc-200 text-transparent",
                    )}
                    aria-hidden
                  >
                    <Check size={15} strokeWidth={3} />
                  </span>
                ) : (
                  <span
                    className={cn(
                      "ml-4 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center border",
                      isSelected ? "border-[#5E3023] bg-[#5E3023] text-white" : "border-zinc-300 bg-zinc-200 text-transparent",
                    )}
                    aria-hidden
                  >
                    <Check size={15} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          <StyleAdditionalInput
            value={customMotivationText}
            onChange={setCustomMotivationText}
            textareaRef={textareaRef}
            onAddClick={() => textareaRef.current?.focus()}
            placeholder="Dis-nous ce que tu cherches ici, avec tes mots à toi"
          />
        </div>
      </form>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
