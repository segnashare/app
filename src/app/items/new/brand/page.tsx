"use client";

import { Montserrat } from "next/font/google";
import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type BrandOption = {
  id: string;
  label: string;
};

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const montserratItalic = Montserrat({ subsets: ["latin"], weight: "500", style: "italic" });

export default function NewItemBrandPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient() as any;
  const initialBrand = searchParams.get("brand") ?? "";
  const initialBrandId = searchParams.get("brandId") ?? "";

  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickedBrandId, setPickedBrandId] = useState<string | null>(() => initialBrandId || null);
  const [pickedBrandLabel, setPickedBrandLabel] = useState<string>(() => initialBrand);

  useEffect(() => {
    let isUnmounted = false;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase.from("item_brands").select("id,label").order("label", { ascending: true });

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

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return brandOptions;
    return brandOptions.filter((brand) => brand.label.toLowerCase().includes(normalized));
  }, [brandOptions, query]);

  const goBack = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  const confirmSelection = () => {
    const params = new URLSearchParams(searchParams.toString());
    const brandId = pickedBrandId ?? brandOptions.find((b) => b.label === pickedBrandLabel)?.id;
    if (brandId && pickedBrandLabel) {
      params.set("brand", pickedBrandLabel);
      params.set("brandId", brandId);
    } else {
      params.delete("brand");
      params.delete("brandId");
    }
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  const toggleBrand = (brand: BrandOption) => {
    if (pickedBrandId === brand.id) {
      setPickedBrandId(null);
      setPickedBrandLabel("");
    } else {
      setPickedBrandId(brand.id);
      setPickedBrandLabel(brand.label);
    }
  };

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
          <p className={cn(montserratItalic.className, "mb-3 mt-4 text-[clamp(16px,2.4vw,18px)] leading-[1.15] text-[#aaaaaa]")}>Sélectionne une marque</p>

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
            {errorMessage ? <p className="py-6 text-sm text-[#E44D3E]">{errorMessage}</p> : null}

            {!isLoading && !errorMessage ? (
              filteredOptions.length > 0 ? (
                filteredOptions.map((brand) => {
                  const isSelected = pickedBrandId === brand.id || (!pickedBrandId && pickedBrandLabel === brand.label);
                  return (
                    <button
                      key={brand.id}
                      type="button"
                      onClick={() => toggleBrand(brand)}
                      className="flex w-full items-center justify-between border-b border-zinc-300 py-5 text-left"
                      aria-pressed={isSelected}
                    >
                      <span className={cn(montserrat.className, "text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>{brand.label}</span>
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
              ) : (
                <p className={cn(montserrat.className, "py-5 text-[14px] text-zinc-500")}>Aucune marque trouvée.</p>
              )
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
