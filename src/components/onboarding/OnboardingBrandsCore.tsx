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

type BrandOption = {
  id: string;
  label: string;
};

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
  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([]);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingBrands, setIsLoadingBrands] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canContinue = selectedBrandIds.length === 3 && !isSubmitting && !isLoadingBrands;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    const loadBrands = async () => {
      setIsLoadingBrands(true);
      const { data, error } = await supabase
        .from("item_brands")
        .select("id,label")
        .order("label", { ascending: true });
      setIsLoadingBrands(false);

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setBrandOptions((data ?? []) as BrandOption[]);
    };

    void loadBrands();
  }, [supabase]);

  const toggleBrand = (brandId: string) => {
    setErrorMessage(null);
    setSelectedBrandIds((prev) => {
      if (prev.includes(brandId)) return prev.filter((item) => item !== brandId);
      if (prev.length >= 3) return prev;
      return [...prev, brandId];
    });
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (selectedBrandIds.length !== 3) {
      setErrorMessage("Choisis exactement 3 marques pour continuer.");
      return;
    }

    setIsSubmitting(true);
    const { error: brandsError } = await supabase.rpc("set_user_profile_brands", {
      p_brand_ids: selectedBrandIds,
      p_request_id: crypto.randomUUID(),
    });
    if (brandsError) {
      setIsSubmitting(false);
      setErrorMessage(brandsError.message);
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/size",
      p_progress_json: {
        checkpoint: "/onboarding/brands",
      },
      p_request_id: crypto.randomUUID(),
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
          {brandOptions.map((brand) => {
            const isSelected = selectedBrandIds.includes(brand.id);
            return (
              <button
                key={brand.id}
                type="button"
                onClick={() => toggleBrand(brand.id)}
                className="flex w-full items-center justify-between border-b border-zinc-300 py-5 text-left"
                aria-pressed={isSelected}
              >
                <span className={cn(montserrat.className, "text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>{brand.label}</span>
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
