"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { NewItemDetailPageShell } from "@/components/items/new-item/NewItemDetailPageShell";
import { getItemInfoDraft, mergeItemInfoDraft } from "@/lib/items/itemInfoDraftStorage";
import { withFromItemParam } from "@/lib/items/new-item-nav";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type MaterialOption = { id: string; label: string };


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
    <NewItemDetailPageShell
      title="Matériaux"
      onCancel={goBack}
      onConfirm={confirm}
      confirmDisabled={!selectedId}
    >
      <p className={cn(montserrat.className, "mb-2 mt-4 text-[14px] text-zinc-500")}>
        Sélectionne le matériau principal de ta pièce.
      </p>
      {isLoading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <div aria-label="Chargement" className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900" />
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
                    isSelected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-zinc-200 text-transparent",
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
    </NewItemDetailPageShell>
  );
}
