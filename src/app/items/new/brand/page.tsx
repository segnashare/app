"use client";

import { Montserrat } from "next/font/google";
import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  formatItemCustomBrandLabel,
  ITEM_BRAND_AUTRE_SLUG,
  ITEM_CUSTOM_BRAND_LABEL_MAX_LEN,
} from "@/lib/items/format-item-custom-brand-label";
import { getItemInfoDraft, mergeItemInfoDraft } from "@/lib/items/itemInfoDraftStorage";
import { withFromItemParam } from "@/lib/items/new-item-nav";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type BrandOption = {
  id: string;
  label: string;
  slug: string;
};

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const montserratItalic = Montserrat({ subsets: ["latin"], weight: "500", style: "italic" });

export default function NewItemBrandPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemId = searchParams.get("itemId")?.trim() || null;
  const supabase = createSupabaseBrowserClient() as any;
  const draft = getItemInfoDraft();
  const initialBrand = draft.brand ?? "";
  const initialBrandId = draft.brandId ?? "";
  const initialCustom = draft.customBrandLabel ?? "";

  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickedBrandId, setPickedBrandId] = useState<string | null>(() => initialBrandId || null);
  const [pickedBrandLabel, setPickedBrandLabel] = useState<string>(() => initialBrand);
  const [customBrandDraft, setCustomBrandDraft] = useState<string>(() => initialCustom);

  useEffect(() => {
    let isUnmounted = false;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase.from("item_brands").select("id,label,slug").order("label", { ascending: true });

      if (isUnmounted) return;
      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }

      setBrandOptions((data ?? []) as BrandOption[]);
      setIsLoading(false);
    };

    void load();
    return () => {
      isUnmounted = true;
    };
  }, [supabase]);

  const autreOption = useMemo(
    () => brandOptions.find((b) => b.slug === ITEM_BRAND_AUTRE_SLUG) ?? null,
    [brandOptions],
  );

  const regularBrands = useMemo(
    () => brandOptions.filter((b) => b.slug !== ITEM_BRAND_AUTRE_SLUG),
    [brandOptions],
  );

  const filteredRegular = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return regularBrands;
    return regularBrands.filter((brand) => brand.label.toLowerCase().includes(normalized));
  }, [regularBrands, query]);

  const goBack = () => {
    const base = itemId ? `/items/new?itemId=${itemId}` : "/items/new";
    router.replace(withFromItemParam(base, searchParams));
  };

  const confirmSelection = () => {
    if (pickedBrandId === autreOption?.id) {
      const formatted = formatItemCustomBrandLabel(customBrandDraft);
      if (!formatted) {
        setErrorMessage("Indique le nom de la marque (max 30 caractères).");
        return;
      }
      mergeItemInfoDraft({
        brandId: autreOption.id,
        brandSlug: ITEM_BRAND_AUTRE_SLUG,
        customBrandLabel: formatted,
        brand: formatted,
      });
    } else {
      const resolved = pickedBrandId ? brandOptions.find((b) => b.id === pickedBrandId) : null;
      if (resolved) {
        mergeItemInfoDraft({
          brandId: resolved.id,
          brandSlug: resolved.slug,
          customBrandLabel: null,
          brand: resolved.label,
        });
      } else {
        mergeItemInfoDraft({ brandId: null, brandSlug: null, customBrandLabel: null, brand: null });
      }
    }
    setErrorMessage(null);
    const base = itemId ? `/items/new?itemId=${itemId}` : "/items/new";
    router.replace(withFromItemParam(base, searchParams));
  };

  const toggleBrand = (brand: BrandOption) => {
    if (pickedBrandId === brand.id) {
      setPickedBrandId(null);
      setPickedBrandLabel("");
      if (brand.slug === ITEM_BRAND_AUTRE_SLUG) {
        setCustomBrandDraft("");
      }
    } else {
      setPickedBrandId(brand.id);
      setPickedBrandLabel(brand.label);
      if (brand.slug !== ITEM_BRAND_AUTRE_SLUG) {
        setCustomBrandDraft("");
      }
    }
  };

  const isAutreSelected = Boolean(autreOption && pickedBrandId === autreOption.id);

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={goBack}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>Marque</h1>
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={confirmSelection}>
          Terminé
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] px-4 pb-8 pt-3">
        <div className="mx-auto w-full max-w-[380px]">
          <p className={cn(montserratItalic.className, "mb-3 mt-4 text-[clamp(16px,2.4vw,18px)] leading-[1.15] text-[#aaaaaa]")}>
            Sélectionne une marque
          </p>

          <div className="mb-3 flex h-11 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3">
            <Search className="h-4 w-4 text-zinc-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Trouver une marque"
              className="h-full w-full bg-transparent text-[16px] text-zinc-800 outline-none placeholder:text-zinc-400"
            />
          </div>

          <div className="max-h-[calc(100dvh-220px)] overflow-y-auto">
            {isLoading ? <p className="py-6 text-sm text-zinc-500">Chargement...</p> : null}
            {errorMessage ? <p className="py-2 text-sm text-[#E44D3E]">{errorMessage}</p> : null}

            {!isLoading ? (
              <>
                {filteredRegular.length > 0 ? (
                  filteredRegular.map((brand) => {
                    const isSelected = pickedBrandId === brand.id || (!pickedBrandId && pickedBrandLabel === brand.label);
                    return (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => toggleBrand(brand)}
                        className="flex w-full items-center justify-between border-b border-zinc-300 py-5 text-left"
                        aria-pressed={isSelected}
                      >
                        <span
                          className={cn(montserrat.className, "text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}
                        >
                          {brand.label}
                        </span>
                        <span
                          className={cn(
                            "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center self-center rounded-full border",
                            isSelected ? "border-[#5E3023] bg-[#5E3023] text-white" : "border-zinc-300 bg-zinc-200 text-transparent",
                          )}
                          aria-hidden
                        >
                          <Check size={15} strokeWidth={3} />
                        </span>
                      </button>
                    );
                  })
                ) : query.trim() ? (
                  <p className={cn(montserrat.className, "py-5 text-[14px] text-zinc-500")}>Aucune marque trouvée dans la liste.</p>
                ) : null}

                {autreOption ? (
                  <div className="mt-2 border-t border-zinc-200 pt-4">
                    <p className={cn(montserrat.className, "mb-2 text-[13px] font-semibold uppercase tracking-wide text-zinc-500")}>
                      Autre
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleBrand(autreOption)}
                      className="flex w-full items-center justify-between border-b border-zinc-300 py-5 text-left"
                      aria-pressed={isAutreSelected}
                    >
                      <span
                        className={cn(montserrat.className, "text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}
                      >
                        {autreOption.label}
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center self-center rounded-full border",
                          isAutreSelected
                            ? "border-[#5E3023] bg-[#5E3023] text-white"
                            : "border-zinc-300 bg-zinc-200 text-transparent",
                        )}
                        aria-hidden
                      >
                        <Check size={15} strokeWidth={3} />
                      </span>
                    </button>
                    {isAutreSelected ? (
                      <label className="mt-3 block space-y-1">
                        <span className={cn(montserrat.className, "text-[13px] font-medium text-zinc-600")}>
                          Nom de la marque ({ITEM_CUSTOM_BRAND_LABEL_MAX_LEN} caractères max.)
                        </span>
                        <input
                          value={customBrandDraft}
                          maxLength={ITEM_CUSTOM_BRAND_LABEL_MAX_LEN}
                          onChange={(e) => setCustomBrandDraft(e.target.value)}
                          onBlur={() => setCustomBrandDraft((v) => formatItemCustomBrandLabel(v))}
                          placeholder="Ex. Maison locale"
                          className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-[16px] text-zinc-900 outline-none focus:border-[#5E3023]"
                        />
                      </label>
                    ) : null}
                  </div>
                ) : !autreOption && !isLoading ? (
                  <p className="mt-4 text-xs text-amber-700">
                    La marque « Autre » n’est pas encore disponible en base. Exécute la migration récente ou ajoute une ligne{" "}
                    <code className="rounded bg-zinc-100 px-1">item_brands</code> avec le slug <code className="rounded bg-zinc-100 px-1">autre</code>.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
