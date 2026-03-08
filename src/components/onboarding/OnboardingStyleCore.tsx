"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { StyleAdditionalInput } from "@/components/onboarding/StyleAdditionalInput";
import { themeClassNames } from "@/styles/theme";

type OnboardingStyleCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const STYLE_OPTIONS = [
  "Clean girl (neutres, coupes simples, pièces quali)",
  "Messy girl (déstructuré, mélange de pièces)",
  "Baddie (cargo, sneakers, ...)",
  "Vintage/friperie (70s-90s, seconde main, ...)",
] as const;

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingStyleCore({ formId, onCanContinueChange }: OnboardingStyleCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [customStyleText, setCustomStyleText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const customStyleRef = useRef<HTMLTextAreaElement | null>(null);

  const normalizedCustom = customStyleText.trim();
  const canContinue = (Boolean(selectedStyle) || normalizedCustom.length >= 4) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedStyle && normalizedCustom.length < 4) {
      setErrorMessage("Choisis un style ou ajoute ta description.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/brands",
      p_progress: {
        checkpoint: "/onboarding/style",
        style_value: selectedStyle,
        style_custom_text: normalizedCustom || null,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/brands");
  };

  return (
    <div className="mt-8 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate>
        <div className="space-y-1">
          {STYLE_OPTIONS.map((option) => {
            const isSelected = selectedStyle === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setSelectedStyle(option)}
                className="flex w-full items-center justify-between border-b border-zinc-300 py-4 text-left"
              >
                <span className={cn(montserrat.className, "pr-4 text-[clamp(15px,3.1vw,23px)] leading-[1.15] text-zinc-950")}>{option}</span>
                <span
                  className={cn(
                    "h-6 w-6 shrink-0 rounded-full border transition",
                    isSelected ? "border-[#5E3023] bg-[#5E3023]" : "border-zinc-300 bg-zinc-200",
                  )}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <StyleAdditionalInput
            value={customStyleText}
            onChange={setCustomStyleText}
            textareaRef={customStyleRef}
            onAddClick={() => customStyleRef.current?.focus()}
          />
        </div>
      </form>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
