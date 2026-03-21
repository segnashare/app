"use client";

import { Montserrat } from "next/font/google";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type ColorOption = { id: string; label: string; slug: string };

// Mapping slug → hex pour les pastilles de couleur
const COLOR_SLUG_TO_HEX: Record<string, string> = {
  noir: "#000000",
  blanc: "#ffffff",
  gris: "#808080",
  "gris-clair": "#d3d3d3",
  "gris-fonce": "#4a4a4a",
  beige: "#f5f5dc",
  bleu: "#2563eb",
  "bleu-marine": "#000080",
  "bleu-clair": "#add8e6",
  "bleu-nuit": "#191970",
  rouge: "#dc2626",
  rose: "#f472b6",
  "rose-clair": "#fce7f3",
  vert: "#16a34a",
  "vert-clair": "#86efac",
  "vert-olive": "#84cc16",
  jaune: "#eab308",
  orange: "#ea580c",
  marron: "#92400e",
  "marron-clair": "#a16207",
  bordeaux: "#722f37",
  violet: "#7c3aed",
  "violet-clair": "#c4b5fd",
  camel: "#c19a6b",
  ecru: "#f5f5dc",
  nude: "#e2c9a9",
  kaki: "#8b7355",
  "multi-colore":
    "linear-gradient(90deg, #ef4444 0%, #eab308 25%, #22c55e 50%, #3b82f6 75%, #a855f7 100%)",
};

function getColorHex(slug: string): { hex: string; isGradient: boolean } {
  const normalized = slug.toLowerCase().trim().replace(/\s+/g, "-");
  const hex = COLOR_SLUG_TO_HEX[normalized] ?? "#cccccc";
  return { hex, isGradient: hex.startsWith("linear-gradient") };
}

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const ACTIVE_DRAFT_ID_STORAGE_KEY = "segna:new-item:active-draft-id";

export default function NewItemColorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient() as any;
  const itemIdFromUrl = searchParams.get("itemId")?.trim() || null;
  const initialColorId = searchParams.get("colorId") ?? "";
  const initialColorLabel = searchParams.get("color") ?? "";

  const [effectiveItemId, setEffectiveItemId] = useState<string | null>(itemIdFromUrl);
  const [options, setOptions] = useState<ColorOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialColorId || null);
  const [selectedLabel, setSelectedLabel] = useState<string>(() => initialColorLabel);

  useEffect(() => {
    const resolved = itemIdFromUrl || sessionStorage.getItem(ACTIVE_DRAFT_ID_STORAGE_KEY) || null;
    setEffectiveItemId(resolved);
  }, [itemIdFromUrl]);

  useEffect(() => {
    let isUnmounted = false;
    const load = async () => {
      const { data } = await supabase
        .from("item_couleurs")
        .select("id,label,slug")
        .order("label", { ascending: true });
      if (isUnmounted) return;
      const list = (data ?? []).map((r: { id: string; label: string; slug: string }) => ({
        id: r.id,
        label: r.label,
        slug: r.slug ?? r.label,
      }));
      setOptions(list);
      if (list.length > 0 && selectedId) {
        const found = list.find((o: ColorOption) => o.id === selectedId);
        if (!found) setSelectedId(null);
      }
      setIsLoading(false);
    };
    void load();
    return () => { isUnmounted = true; };
  }, [supabase]);

  const goBack = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  const confirm = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (effectiveItemId) params.set("itemId", effectiveItemId);
    if (selectedId && selectedLabel) {
      params.set("colorId", selectedId);
      params.set("color", selectedLabel);
    } else {
      params.delete("colorId");
      params.delete("color");
    }
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  const selectOption = (opt: ColorOption) => {
    if (selectedId === opt.id) {
      setSelectedId(null);
      setSelectedLabel("");
    } else {
      setSelectedId(opt.id);
      setSelectedLabel(opt.label);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="sticky top-0 z-10 mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 bg-white px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={goBack}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>
          Couleur
        </h1>
        <button
          type="button"
          className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023] disabled:opacity-40")}
          disabled={!selectedId}
          onClick={confirm}
        >
          Terminé
        </button>
      </header>
      <section className="mx-auto w-full max-w-[460px] px-4 pb-8 pt-3">
        <div className="mx-auto w-full max-w-[380px]">
          <p className={cn(montserrat.className, "mb-2 mt-4 text-[14px] text-zinc-500")}>
            Sélectionne la couleur principale de ta pièce.
          </p>
          {isLoading ? (
            <div className="flex min-h-[120px] items-center justify-center">
              <div aria-label="Chargement" className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-[#5E3023]" />
            </div>
          ) : options.length === 0 ? (
            <p className={cn(montserrat.className, "py-6 text-[14px] text-zinc-500")}>Aucune couleur disponible.</p>
          ) : (
            <div className="space-y-0.5">
              {options.map((opt) => {
                const isSelected = selectedId === opt.id;
                const { hex, isGradient } = getColorHex(opt.slug);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectOption(opt)}
                    className="flex w-full items-center justify-between gap-4 border-b border-zinc-300 py-4 text-left"
                    aria-pressed={isSelected}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        className={cn(
                          montserrat.className,
                          "text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950",
                        )}
                      >
                        {opt.label}
                      </span>
                      <span
                        className="inline-block h-6 w-6 shrink-0 rounded-full border border-zinc-300"
                        style={isGradient ? { background: hex } : { backgroundColor: hex }}
                        aria-hidden
                      />
                    </div>
                    <span
                      className={cn(
                        "ml-2 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border",
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
          )}
        </div>
      </section>
    </main>
  );
}
