"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type OnboardingBrandsCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const BRAND_OPTIONS = [
  "Rouje",
  "Sézane",
  "Maje",
  "Sandro",
  "Ba&sh",
  "Ami Paris",
  "Jacquemus",
  "Isabel Marant",
  "The Kooples",
  "Claudie Pierlot",
  "Anine Bing",
  "Ganni",
  "COS",
  "& Other Stories",
  "Zadig & Voltaire",
] as const;

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});
const montserratItalic = Montserrat({
  subsets: ["latin"],
  weight: "500",
  style: "italic",
});

export function OnboardingBrandsCore({ formId, onCanContinueChange }: OnboardingBrandsCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canContinue = selectedBrands.length === 3 && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const toggleBrand = (brand: string) => {
    setErrorMessage(null);
    setSelectedBrands((prev) => {
      if (prev.includes(brand)) return prev.filter((item) => item !== brand);
      if (prev.length >= 3) return prev;
      return [...prev, brand];
    });
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (selectedBrands.length !== 3) {
      setErrorMessage("Choisis exactement 3 marques pour continuer.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/size",
      p_progress: {
        checkpoint: "/onboarding/brands",
        brands_value: selectedBrands,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/size");
  };

  return (
    <div className="mt-8 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate>
        <p className={cn(montserratItalic.className, "mb-3 text-[clamp(16px,2.4vw,18px)] leading-[1.15] text-[#aaaaaa]")}>
          Choisis 3 de tes marques préférées !
        </p>

        <div className="max-h-[355px] overflow-y-auto pr-1">
          {BRAND_OPTIONS.map((brand) => {
            const isSelected = selectedBrands.includes(brand);
            return (
              <button
                key={brand}
                type="button"
                onClick={() => toggleBrand(brand)}
                className="flex w-full items-center justify-between border-b border-zinc-300 py-5 text-left"
                aria-pressed={isSelected}
              >
                <span className={cn(montserrat.className, "text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>{brand}</span>
                <span
                  className={cn(
                    "inline-flex h-[26px] w-[26px] items-center justify-center border",
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
      </form>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
