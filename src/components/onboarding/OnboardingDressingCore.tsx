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

type OnboardingDressingCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const DRESSING_OPTIONS = [
  "Trop plein, ça déborde de partout",
  "Je l’aime bien, mais je tourne un peu en rond",
  "Il me manque des pièces iconiques en plus de mes basiques",
] as const;

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingDressingCore({ formId, onCanContinueChange }: OnboardingDressingCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedDressingOptions, setSelectedDressingOptions] = useState<string[]>([]);
  const [customDressingText, setCustomDressingText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedCustomDressing = customDressingText.trim();
  const canContinue = (selectedDressingOptions.length > 0 || normalizedCustomDressing.length >= 4) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (selectedDressingOptions.length === 0 && normalizedCustomDressing.length < 4) {
      setErrorMessage("Choisis au moins une réponse ou ajoute ton texte.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/ethic",
      p_progress: {
        checkpoint: "/onboarding/dressing",
        dressing_value: selectedDressingOptions,
        dressing_custom_text: normalizedCustomDressing || null,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/ethic");
  };

  return (
    <div className="mt-7 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate>
        <div className="space-y-0.5">
          {DRESSING_OPTIONS.map((option) => {
            const isSelected = selectedDressingOptions.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setSelectedDressingOptions((prev) => {
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
            value={customDressingText}
            onChange={setCustomDressingText}
            textareaRef={textareaRef}
            onAddClick={() => textareaRef.current?.focus()}
            placeholder="Explique-nous ce qui te plaît (ou pas) dans ton dressing"
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
