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

type OnboardingShareCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const SHARE_OPTIONS = [
  "Des pièces récentes que je porte très peu",
  "Des pièces fortes que j’aime beaucoup, mais qui restent souvent au placard",
  "Des pièces vraiment premium / chères, si le cadre est sécurisé",
  "Je verrai plus tard, je veux d’abord tester les emprunts",
] as const;
const LATER_OPTION = "Je verrai plus tard, je veux d’abord tester les emprunts";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingShareCore({ formId, onCanContinueChange }: OnboardingShareCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedShareOptions, setSelectedShareOptions] = useState<string[]>([]);
  const [customShareText, setCustomShareText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedCustomShare = customShareText.trim();
  const canContinue = (selectedShareOptions.length > 0 || normalizedCustomShare.length >= 4) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (selectedShareOptions.length === 0 && normalizedCustomShare.length < 4) {
      setErrorMessage("Choisis au moins une réponse ou ajoute ton texte.");
      return;
    }

    setIsSubmitting(true);
    const { error: profileError } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        preferences: {
          share: {
            value: selectedShareOptions,
            custom_text: normalizedCustomShare || null,
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
      p_current_step: "/onboarding/budget",
      p_progress_json: {
        checkpoint: "/onboarding/share",
      },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/budget");
  };

  return (
    <div className="mt-4 h-full min-h-0 w-full">
      <div className="h-full min-h-0 overflow-y-auto pr-1">
        <form id={formId} onSubmit={onSubmit} noValidate>
        <div className="max-h-[450px] overflow-y-auto pr-1">
          <div className="space-y-0.5">
          {SHARE_OPTIONS.map((option) => {
            const isSelected = selectedShareOptions.includes(option);
            const isLaterOption = option === LATER_OPTION;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setSelectedShareOptions((prev) => {
                    const alreadySelected = prev.includes(option);
                    if (alreadySelected) return prev.filter((item) => item !== option);
                    if (isLaterOption) return [option];
                    return [...prev.filter((item) => item !== LATER_OPTION), option];
                  });
                }}
                className="flex w-full items-center justify-between border-b border-zinc-300 py-4 text-left"
                aria-pressed={isSelected}
              >
                <span className={cn(montserrat.className, "max-w-[84%] text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>{option}</span>
                {isLaterOption ? (
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
        </div>

        <div className="mt-6">
          <StyleAdditionalInput
            value={customShareText}
            onChange={setCustomShareText}
            textareaRef={textareaRef}
            onAddClick={() => textareaRef.current?.focus()}
            placeholder="Explique ce que tu gardes pour toi, et ce que tu imagines bien prêter"
            rows={2}
            containerClassName="pb-2 pt-2"
            textareaClassName="min-h-[50px]"
          />
        </div>
        </form>
      </div>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
