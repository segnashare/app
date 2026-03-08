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

type OnboardingBudgetCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const BUDGET_OPTIONS = [
  "Je claque trop, j’aimerais vraiment canaliser.",
  "Je fais attention, mais je me fais plaisir de temps en temps.",
  "Je dépense peu, je cherche des solutions malines.",
  "Je ne compte pas",
] as const;

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingBudgetCore({ formId, onCanContinueChange }: OnboardingBudgetCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedBudget, setSelectedBudget] = useState<string | null>(null);
  const [customBudgetText, setCustomBudgetText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedCustomBudget = customBudgetText.trim();
  const canContinue = (Boolean(selectedBudget) || normalizedCustomBudget.length >= 4) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedBudget && normalizedCustomBudget.length < 4) {
      setErrorMessage("Choisis une réponse ou ajoute ton texte.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/dressing",
      p_progress: {
        checkpoint: "/onboarding/budget",
        budget_value: selectedBudget,
        budget_custom_text: normalizedCustomBudget || null,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/dressing");
  };

  return (
    <div className="mt-7 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate>
        <div className="space-y-0.5">
          {BUDGET_OPTIONS.map((option) => {
            const isSelected = selectedBudget === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setSelectedBudget((prev) => (prev === option ? null : option));
                }}
                className="flex w-full items-center justify-between border-b border-zinc-300 py-4 text-left"
                aria-pressed={isSelected}
              >
                <span className={cn(montserrat.className, "max-w-[84%] text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>{option}</span>
                <span
                  className={cn(
                    "ml-4 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border",
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
            value={customBudgetText}
            onChange={setCustomBudgetText}
            textareaRef={textareaRef}
            onAddClick={() => textareaRef.current?.focus()}
            placeholder="Dis-nous comment tu gères (ou pas) ton budget vêtements."
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
