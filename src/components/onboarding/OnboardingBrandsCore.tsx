"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;
const montserratItalic = segnaMontserrat;

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type OnboardingBrandsCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  redirectPath?: string;
  initialSelectedBrandIds?: string[];
  showRankSection?: boolean;
};

type BrandOption = {
  id: string;
  label: string;
};

function BrandPill({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        montserrat.className,
        "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 py-2 text-[14px] font-semibold transition-colors sm:px-4 sm:text-[15px]",
        selected
          ? "border-black bg-black text-white"
          : "border-zinc-200 bg-white text-zinc-900 shadow-[0_2px_10px_rgba(0,0,0,0.07)] hover:border-zinc-300",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          selected ? "bg-white/20 text-white" : "border border-zinc-300 bg-zinc-50 text-zinc-600",
        )}
        aria-hidden
      >
        {selected ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />}
      </span>
    </button>
  );
}

export function OnboardingBrandsCore({
  formId,
  onCanContinueChange,
  redirectPath,
  initialSelectedBrandIds,
  showRankSection = false,
}: OnboardingBrandsCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([]);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingBrands, setIsLoadingBrands] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  useEffect(() => {
    if (!Array.isArray(initialSelectedBrandIds)) return;
    setSelectedBrandIds(initialSelectedBrandIds.slice(0, 3));
  }, [initialSelectedBrandIds]);

  const toggleBrand = (brandId: string) => {
    setErrorMessage(null);
    setSelectedBrandIds((prev) => {
      if (prev.includes(brandId)) return prev.filter((item) => item !== brandId);
      if (prev.length >= 3) return prev;
      return [...prev, brandId];
    });
  };

  const filteredBrandOptions = brandOptions.filter((brand) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return brand.label.toLowerCase().includes(query);
  });

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

    router.push(redirectPath ?? "/onboarding/size");
  };

  return (
    <div className="mt-8 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate>
        <p className={cn(montserratItalic.className, "mb-3 text-[clamp(16px,2.4vw,18px)] leading-[1.15] text-[#aaaaaa]")}>
          Choisis 3 de tes marques préférées !
        </p>

        <div className="mb-3 flex h-11 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Trouver une marque"
            className="h-full w-full bg-transparent text-[16px] text-zinc-800 outline-none placeholder:text-zinc-400"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {filteredBrandOptions.map((brand) => {
            const isSelected = selectedBrandIds.includes(brand.id);
            return (
              <BrandPill
                key={brand.id}
                label={brand.label}
                selected={isSelected}
                onToggle={() => toggleBrand(brand.id)}
              />
            );
          })}
          {filteredBrandOptions.length === 0 ? (
            <p className={cn(montserrat.className, "py-5 text-[14px] text-zinc-500")}>Aucune marque trouvée.</p>
          ) : null}
        </div>

        {showRankSection && selectedBrandIds.length > 0 ? (
          <p className={cn(montserrat.className, "mt-3 text-[13px] font-medium text-zinc-500")}>
            {selectedBrandIds.length}/3 marques sélectionnées
          </p>
        ) : null}
      </form>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
