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
  redirectPath?: string;
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

export function OnboardingStyleCore({ formId, onCanContinueChange, redirectPath }: OnboardingStyleCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const rpcUntyped = async (fn: string, args?: Record<string, unknown>) =>
    (supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data?: Record<string, unknown> | null; error?: { message?: string } | null } | undefined>)(fn, args);
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

  useEffect(() => {
    let mounted = true;
    const loadSavedPreference = async () => {
      const response = await rpcUntyped("get_user_preferences_payload");
      const data = response?.data ?? null;
      if (!mounted || !data) return;

      const style = data.style as { preference?: { value?: unknown; custom?: unknown } } | undefined;
      const preference = style?.preference;
      const savedValue = typeof preference?.value === "string" ? preference.value : null;
      const savedCustom = typeof preference?.custom === "string" ? preference.custom : "";

      if (savedValue && STYLE_OPTIONS.includes(savedValue as (typeof STYLE_OPTIONS)[number])) {
        setSelectedStyle(savedValue);
      }
      setCustomStyleText(savedCustom);
    };
    void loadSavedPreference();
    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedStyle && normalizedCustom.length < 4) {
      setErrorMessage("Choisis un style ou ajoute ta description.");
      return;
    }

    setIsSubmitting(true);
    const { error: profileError } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        preferences: {
          style: {
            value: selectedStyle,
            custom_text: normalizedCustom || null,
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
      p_current_step: "/onboarding/brands",
      p_progress_json: {
        checkpoint: "/onboarding/style",
      },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(redirectPath ?? "/onboarding/brands");
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
