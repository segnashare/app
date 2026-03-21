"use client";

import { Montserrat } from "next/font/google";
import { Check, Search, ChevronRight, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type ItemCategory = {
  id: string;
  name: string;
  parent_category_id: string | null;
};

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const montserratItalic = Montserrat({ subsets: ["latin"], weight: "500", style: "italic" });

export default function NewItemCategoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient() as any;

  const initialCategoryId = searchParams.get("categoryId") ?? "";
  const initialCategoryName = searchParams.get("category") ?? "";

  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pickedCategoryId, setPickedCategoryId] = useState<string | null>(() => initialCategoryId || null);
  const [pickedCategoryName, setPickedCategoryName] = useState<string>(() => initialCategoryName);

  useEffect(() => {
    let isUnmounted = false;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      const { data, error } = await supabase
        .from("item_categories")
        .select("id,name,parent_category_id")
        .order("name", { ascending: true });

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

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, ItemCategory[]>();
    for (const category of categories) {
      const parentId = category.parent_category_id ?? null;
      const list = map.get(parentId) ?? [];
      list.push(category);
      map.set(parentId, list);
    }
    for (const [key, list] of map.entries()) {
      map.set(
        key,
        [...list].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" })),
      );
    }
    return map;
  }, [categories]);

  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const filteredResults = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    const pathLabel = (category: ItemCategory) => {
      const names = [category.name];
      let current = category;
      while (current.parent_category_id) {
        const parent = categoryById.get(current.parent_category_id);
        if (!parent) break;
        names.unshift(parent.name);
        current = parent;
      }
      return names.join(" > ");
    };

    return categories
      .filter((category) => category.name.toLowerCase().includes(normalizedQuery))
      .map((category) => ({ category, path: pathLabel(category) }));
  }, [categories, categoryById, query]);

  const goBack = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
  };

  const confirmSelection = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (pickedCategoryId && pickedCategoryName) {
      params.set("category", pickedCategoryName);
      params.set("categoryId", pickedCategoryId);
    } else {
      params.delete("category");
      params.delete("categoryId");
    }
    params.delete("photoModifyId");
    router.push(`/items/new?${params.toString()}`);
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

  const toggleExpanded = (categoryId: string) => {
    setExpanded((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
  };

  const renderTree = (parentId: string | null, depth = 0): React.ReactNode => {
    const children = childrenByParent.get(parentId) ?? [];
    if (children.length === 0) return null;

    return children.map((category) => {
      const nestedChildren = childrenByParent.get(category.id) ?? [];
      const hasChildren = nestedChildren.length > 0;
      const isOpen = expanded[category.id] ?? false;
      const isSelected = pickedCategoryId === category.id;

      return (
        <div key={category.id}>
          <button
            type="button"
            onClick={() => (hasChildren ? toggleExpanded(category.id) : toggleCategory(category))}
            className="flex w-full items-center justify-between gap-3 border-b border-zinc-300 py-4 text-left"
            style={{ paddingLeft: `${16 + depth * 16}px` }}
          >
            <span className="text-[16px] font-medium text-zinc-900">{category.name}</span>
            {hasChildren ? (
              isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
            ) : (
              <span
                className={cn(
                  "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center self-center rounded-full border",
                  isSelected ? "border-[#5E3023] bg-[#5E3023] text-white" : "border-zinc-300 bg-zinc-200 text-transparent",
                )}
                aria-hidden
              >
                <Check size={15} strokeWidth={3} />
              </span>
            )}
          </button>
          {hasChildren && isOpen ? <div className="border-t border-zinc-100">{renderTree(category.id, depth + 1)}</div> : null}
        </div>
      );
    });
  };

  return (
    <main className="min-h-[100dvh] bg-white">
      <header className="mx-auto flex w-full max-w-[460px] items-center justify-between border-b border-zinc-100 px-5 pb-4 pt-7">
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={goBack}>
          Annuler
        </button>
        <h1 className={cn(montserrat.className, "text-center text-[24px] font-bold leading-none text-zinc-900")}>Catégorie</h1>
        <button type="button" className={cn(montserrat.className, "text-[18px] font-semibold text-[#5E3023]")} onClick={confirmSelection}>
          Terminé
        </button>
      </header>

      <section className="mx-auto w-full max-w-[460px] px-4 pb-8 pt-3">
        <div className="mx-auto w-full max-w-[380px]">
          <p className={cn(montserratItalic.className, "mb-3 mt-4 text-[clamp(16px,2.4vw,18px)] leading-[1.15] text-[#aaaaaa]")}>Sélectionne une catégorie</p>

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
            {errorMessage ? <p className="px-4 py-6 text-sm text-[#E44D3E]">{errorMessage}</p> : null}

            {!isLoading && !errorMessage ? (
              query.trim().length > 0 ? (
                filteredResults.length > 0 ? (
                  filteredResults.map(({ category, path }) => {
                    const isSelected = pickedCategoryId === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleCategory(category)}
                        className="flex w-full items-center justify-between gap-3 border-b border-zinc-300 py-4 text-left"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[16px] font-medium text-zinc-900">{category.name}</p>
                          <p className="truncate text-[12px] text-zinc-500">{path}</p>
                        </div>
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
                  <p className="px-4 py-6 text-sm text-zinc-500">Aucune catégorie trouvée.</p>
                )
              ) : (
                <div>{renderTree(null, 0)}</div>
              )
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
