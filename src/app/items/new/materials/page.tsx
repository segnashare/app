"use client";

import { Montserrat } from "next/font/google";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getItemInfoDraft, mergeItemInfoDraft } from "@/lib/items/itemInfoDraftStorage";
import { withFromItemParam } from "@/lib/items/new-item-nav";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type MaterialOption = { id: string; label: string };

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const ACTIVE_DRAFT_ID_STORAGE_KEY = "segna:new-item:active-draft-id";

export default function NewItemMaterialsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient() as any;
  const itemIdFromUrl = searchParams.get("itemId")?.trim() || null;
  const initialMaterialsId = searchParams.get("materialsId") ?? "";
  const initialMaterialsLabel = searchParams.get("materials") ?? "";

  const [effectiveItemId, setEffectiveItemId] = useState<string | null>(itemIdFromUrl);
  const [options, setOptions] = useState<MaterialOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialMaterialsId || null);
  const [selectedLabel, setSelectedLabel] = useState<string>(() => initialMaterialsLabel);

  useEffect(() => {
    const resolved = itemIdFromUrl || sessionStorage.getItem(ACTIVE_DRAFT_ID_STORAGE_KEY) || null;
    setEffectiveItemId(resolved);
  }, [itemIdFromUrl]);

  useEffect(() => {
    let isUnmounted = false;
    const load = async () => {
      const { data } = await supabase
        .from("item_materiaux")
        .select("id,label,slug")
        .order("label", { ascending: true });
      if (isUnmounted) return;
      const list = (data ?? []).map((r: { id: string; label: string }) => ({ id: r.id, label: r.label }));
      setOptions(list);
      if (list.length > 0 && selectedId) {
        const found = list.find((o: MaterialOption) => o.id === selectedId);
        if (!found) setSelectedId(null);
      }
      setIsLoading(false);
    };
    void load();
    return () => { isUnmounted = true; };
  }, [supabase]);

  const goBack = () => {
    const base = effectiveItemId ? `/items/new?itemId=${effectiveItemId}` : "/items/new";
    router.replace(withFromItemParam(base, searchParams));
  };

  const confirm = () => {
    if (selectedId && selectedLabel) {
      mergeItemInfoDraft({ materialsId: selectedId, materials: selectedLabel });
    } else {
      mergeItemInfoDraft({ materialsId: null, materials: null });
    }
    const base = effectiveItemId ? `/items/new?itemId=${effectiveItemId}` : "/items/new";
    router.replace(withFromItemParam(base, searchParams));
  };

  const selectOption = (opt: MaterialOption) => {
    if (selectedId === opt.id) {
      setSelectedId(null);
      setSelectedLabel("");
    } else {
      setSelectedId(opt.id);
      setSelectedLabel(opt.label);
    }
  };

  return (
    <main className="flex min-h-[100dvh] flex-col overflow-hidden bg-white">
      <header className="shrink-0 mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 bg-white px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={goBack}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>
          Matériaux
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
      <section className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[380px] px-4 pb-8 pt-3">
          <p className={cn(montserrat.className, "mb-2 mt-4 text-[14px] text-zinc-500")}>
            Sélectionne le matériau principal de ta pièce.
          </p>
          {isLoading ? (
            <div className="flex min-h-[120px] items-center justify-center">
              <div aria-label="Chargement" className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-[#5E3023]" />
            </div>
          ) : options.length === 0 ? (
            <p className={cn(montserrat.className, "py-6 text-[14px] text-zinc-500")}>Aucun matériau disponible.</p>
          ) : (
            <div className="space-y-0.5">
              {options.map((opt) => {
                const isSelected = selectedId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectOption(opt)}
                    className="flex w-full items-center justify-between border-b border-zinc-300 py-4 text-left"
                    aria-pressed={isSelected}
                  >
                    <span className={cn(montserrat.className, "max-w-[84%] text-[clamp(18px,3.7vw,29px)] font-semibold leading-[1.1] text-zinc-950")}>
                      {opt.label}
                    </span>
                    <span
                      className={cn(
                        "ml-4 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border",
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
