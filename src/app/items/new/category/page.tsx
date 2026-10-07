"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserratItalic = segnaMontserrat;

import { NewItemDetailPageShell } from "@/components/items/new-item/NewItemDetailPageShell";
import { mergeItemInfoDraft, getItemInfoDraft } from "@/lib/items/itemInfoDraftStorage";
import { withFromItemParam } from "@/lib/items/new-item-nav";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type ItemCategory = {
  id: string;
  name: string;
  sort_order?: number;
};

export default function NewItemCategoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemId = searchParams.get("itemId")?.trim() || null;
  const supabase = createSupabaseBrowserClient() as any;
  const draft = getItemInfoDraft();
  const initialCategoryId = draft.categoryId ?? "";
  const initialCategoryName = draft.category ?? "";

  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickedCategoryId, setPickedCategoryId] = useState<string | null>(() => initialCategoryId || null);
  const [pickedCategoryName, setPickedCategoryName] = useState<string>(() => initialCategoryName);

  useEffect(() => {
    let isUnmounted = false;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase
        .from("item_categories")
        .select("id,name,sort_order")
        .order("sort_order", { ascending: true });

      if (isUnmounted) return;
      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }
      setCategories((data ?? []) as ItemCategory[]);
      setIsLoading(false);
    };

    void load();
    return () => {
      isUnmounted = true;
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...categories].sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }),
    );
    if (!q) return sorted;
    return sorted.filter((category) => category.name.toLowerCase().includes(q));
  }, [categories, query]);

  const goBack = () => {
    const base = itemId ? `/items/new?itemId=${itemId}` : "/items/new";
    router.replace(withFromItemParam(base, searchParams));
  };

  const confirmSelection = () => {
    if (pickedCategoryId && pickedCategoryName) {
      mergeItemInfoDraft({ categoryId: pickedCategoryId, category: pickedCategoryName });
    } else {
      mergeItemInfoDraft({ categoryId: null, category: null });
    }
    const base = itemId ? `/items/new?itemId=${itemId}` : "/items/new";
    router.replace(withFromItemParam(base, searchParams));
  };

  const toggleCategory = (category: ItemCategory) => {
    if (pickedCategoryId === category.id) {
      setPickedCategoryId(null);
      setPickedCategoryName("");
    } else {
      setPickedCategoryId(category.id);
      setPickedCategoryName(category.name);
    }
  };

  return (
    <NewItemDetailPageShell title="Catégorie" onCancel={goBack} onConfirm={confirmSelection}>
      <p className={cn(montserratItalic.className, "mb-3 mt-4 text-[clamp(16px,2.4vw,18px)] leading-[1.15] text-[#aaaaaa]")}>
        Sélectionne une catégorie
      </p>

      <div className="flex h-11 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3">
        <Search className="h-4 w-4 text-zinc-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Trouver une catégorie"
          className="h-full w-full bg-transparent text-[16px] text-zinc-800 outline-none placeholder:text-zinc-400"
        />
      </div>

      <div className="mt-4 max-h-[calc(100dvh-220px)] overflow-y-auto">
        {isLoading ? <p className="px-4 py-6 text-sm text-zinc-500">Chargement...</p> : null}
        {errorMessage ? <p className="px-4 py-6 text-sm text-zinc-600">{errorMessage}</p> : null}

        {!isLoading && !errorMessage ? (
          filtered.length > 0 ? (
            filtered.map((category) => {
              const isSelected = pickedCategoryId === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className="flex w-full items-center justify-between gap-3 border-b border-zinc-300 py-4 text-left"
                >
                  <p className="truncate text-[16px] font-medium uppercase tracking-wide text-zinc-900">
                    {category.name}
                  </p>
                  <span
                    className={cn(
                      "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center self-center rounded-full border",
                      isSelected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-zinc-200 text-transparent",
                    )}
                    aria-hidden
                  >
                    <Check size={15} strokeWidth={3} />
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-4 py-6 text-sm text-zinc-500">Aucune catégorie trouvée.</p>
          )
        ) : null}
      </div>
    </NewItemDetailPageShell>
  );
}
