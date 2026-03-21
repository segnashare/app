"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";

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

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});
const montserratItalic = Montserrat({
  subsets: ["latin"],
  weight: "500",
  style: "italic",
});

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
  const [draggingRankIndex, setDraggingRankIndex] = useState<number | null>(null);
  const [dragOverRankIndex, setDragOverRankIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const rankItemRefs = useRef<Array<HTMLDivElement | null>>([]);

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

  const selectedBrands = selectedBrandIds
    .map((id) => brandOptions.find((option) => option.id === id))
    .filter((option): option is BrandOption => Boolean(option));

  const filteredBrandOptions = brandOptions.filter((brand) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return brand.label.toLowerCase().includes(query);
  });

  const moveBrandRank = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setSelectedBrandIds((previous) => {
      const next = [...previous];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return previous;
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const removeBrand = (brandId: string) => {
    setSelectedBrandIds((previous) => previous.filter((id) => id !== brandId));
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

        <div className="max-h-[355px] overflow-y-auto pr-1">
          {filteredBrandOptions.map((brand) => {
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
          {filteredBrandOptions.length === 0 ? (
            <p className={cn(montserrat.className, "py-5 text-[14px] text-zinc-500")}>Aucune marque trouvée.</p>
          ) : null}
        </div>

        {showRankSection && selectedBrands.length > 0 ? (
          <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3">
            <p className={cn(montserrat.className, "mb-2 text-[14px] text-zinc-500")}>Classe tes 3 marques (1 = prioritaire)</p>
            <div className="space-y-2">
              {selectedBrands.map((brand, index) => (
                <div
                  key={`rank-${brand.id}`}
                  ref={(node) => {
                    rankItemRefs.current[index] = node;
                  }}
                  draggable
                  onPointerDown={(event) => {
                    // Fallback for touch/mobile where native HTML5 drag is unreliable.
                    if (event.pointerType !== "touch") return;
                    const target = event.target as HTMLElement | null;
                    if (target?.closest("[data-remove-brand='true']")) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDraggingRankIndex(index);
                    setDragOverRankIndex(index);
                  }}
                  onPointerMove={(event) => {
                    if (event.pointerType !== "touch") return;
                    if (draggingRankIndex === null) return;
                    const targetIndex = rankItemRefs.current.findIndex((node) => {
                      if (!node) return false;
                      const rect = node.getBoundingClientRect();
                      return event.clientY >= rect.top && event.clientY <= rect.bottom;
                    });
                    if (targetIndex === -1 || targetIndex === draggingRankIndex) return;
                    moveBrandRank(draggingRankIndex, targetIndex);
                    setDraggingRankIndex(targetIndex);
                    setDragOverRankIndex(targetIndex);
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType !== "touch") return;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                    setDraggingRankIndex(null);
                    setDragOverRankIndex(null);
                  }}
                  onPointerCancel={(event) => {
                    if (event.pointerType !== "touch") return;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                    setDraggingRankIndex(null);
                    setDragOverRankIndex(null);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", brand.id);
                    setDraggingRankIndex(index);
                    setDragOverRankIndex(index);
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    if (draggingRankIndex === null || draggingRankIndex === index) return;
                    moveBrandRank(draggingRankIndex, index);
                    setDraggingRankIndex(index);
                    setDragOverRankIndex(index);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverRankIndex(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDraggingRankIndex(null);
                    setDragOverRankIndex(null);
                  }}
                  onDragEnd={() => {
                    setDraggingRankIndex(null);
                    setDragOverRankIndex(null);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition",
                    dragOverRankIndex === index ? "border-[#5E3023] bg-[#f3ece5]" : "border-zinc-200 bg-white",
                  )}
                  style={{ touchAction: "none" }}
                >
                  <div className="inline-flex items-center gap-3">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#5E3023] text-xs font-semibold text-white">{index + 1}</span>
                    <span className={cn(montserrat.className, "text-[15px] text-zinc-900")}>{brand.label}</span>
                  </div>
                  <button
                    type="button"
                    data-remove-brand="true"
                    aria-label={`Retirer ${brand.label}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      removeBrand(brand.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      removeBrand(brand.id);
                    }}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 text-zinc-500"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </form>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
