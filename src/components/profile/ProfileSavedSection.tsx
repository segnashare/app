"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { InspirationMasonryGrid } from "@/components/community/InspirationMasonryGrid";
import { ShopCatalogGridItemCard } from "@/components/shop/ShopCatalog";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { useToggleCartItem } from "@/hooks/useToggleCartItem";
import {
  loadMemberSavedLibrary,
  type MemberSavedLibraryEntry,
} from "@/lib/profile/load-member-saved-library";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const SHIMMER_SEC = 2.85;

type SavedLibraryTab = "articles" | "looks";

function SavedLibraryTabToggle({
  value,
  onChange,
}: {
  value: SavedLibraryTab;
  onChange: (value: SavedLibraryTab) => void;
}) {
  const tabs: Array<{ id: SavedLibraryTab; label: string }> = [
    { id: "articles", label: "Articles" },
    { id: "looks", label: "Looks" },
  ];

  return (
    <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-0.5" role="tablist" aria-label="Type d'enregistrements">
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex h-8 min-w-[4.75rem] items-center justify-center rounded-[10px] px-2.5 text-[12px] font-semibold transition",
              active ? "bg-zinc-900 text-white" : "text-zinc-700",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function ProfileSavedSection() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { cartItemIds, cartBusyIds, toggleCart } = useToggleCartItem();
  const [entries, setEntries] = useState<MemberSavedLibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [likeBusyIds, setLikeBusyIds] = useState<Set<string>>(() => new Set());
  const [activeTab, setActiveTab] = useState<SavedLibraryTab>("articles");

  const load = useCallback(async () => {
    setIsLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setEntries([]);
      setIsLoading(false);
      return;
    }

    try {
      const next = await loadMemberSavedLibrary(supabase, user.id);
      setEntries(next);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemEntries = useMemo(
    () => entries.filter((entry): entry is Extract<MemberSavedLibraryEntry, { kind: "item" }> => entry.kind === "item"),
    [entries],
  );
  const lookEntries = useMemo(
    () => entries.filter((entry): entry is Extract<MemberSavedLibraryEntry, { kind: "look" }> => entry.kind === "look"),
    [entries],
  );

  const withLikeBusy = useCallback(async (itemId: string, action: () => Promise<void>) => {
    if (likeBusyIds.has(itemId)) return;
    setLikeBusyIds((current) => new Set([...current, itemId]));
    try {
      await action();
    } finally {
      setLikeBusyIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  }, [likeBusyIds]);

  const handleToggleLike = useCallback(
    async (itemId: string) => {
      await withLikeBusy(itemId, async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        await supabase
          .from("item_favorites")
          .update({ deleted_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("item_id", itemId)
          .is("deleted_at", null);

        setEntries((current) => current.filter((row) => row.key !== `item:${itemId}`));
      });
    },
    [supabase, withLikeBusy],
  );

  const handleRemoveLook = useCallback((key: string) => {
    setEntries((current) => current.filter((row) => row.key !== key));
  }, []);

  const emptyMessage =
    activeTab === "articles"
      ? "Les pièces que tu enregistres apparaîtront ici."
      : "Les looks que tu likes apparaîtront ici.";

  return (
    <section className="w-full space-y-4 bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME, "min-w-0")}>
          Enregistrés
        </h2>
        <SavedLibraryTabToggle value={activeTab} onChange={setActiveTab} />
      </div>
      {isLoading ? (
        activeTab === "articles" ? (
          <div className="grid grid-cols-2 gap-3" aria-hidden>
            {[0, 1, 2, 3].map((index) => (
              <SegnaSkeletonBlock key={index} className="aspect-[3/4] w-full" rounded="rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="columns-2 gap-3" aria-hidden>
            {[0, 1, 2, 3].map((index) => (
              <SegnaSkeletonBlock key={index} className="mb-3 aspect-[3/4] w-full break-inside-avoid" rounded="rounded-2xl" />
            ))}
          </div>
        )
      ) : activeTab === "articles" ? (
        itemEntries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
            {emptyMessage}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {itemEntries.map((entry) => (
              <ShopCatalogGridItemCard
                key={entry.key}
                item={entry.item}
                cover={entry.coverUrl}
                shimmerDurationSec={SHIMMER_SEC}
                canAddToCart={entry.item.status === "available" || entry.item.status === "in_cart"}
                inCart={cartItemIds.has(entry.item.id)}
                liked
                likeBusyIds={likeBusyIds}
                cartBusyIds={cartBusyIds}
                onToggleLike={handleToggleLike}
                onToggleCart={toggleCart}
                onNavigate={() => {}}
                itemFromQuery="profile"
              />
            ))}
          </div>
        )
      ) : activeTab === "looks" ? (
        lookEntries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
            {emptyMessage}
          </p>
        ) : (
          <InspirationMasonryGrid
            cards={lookEntries.map((entry) => entry.card)}
            compact
            shimmerDurationSec={SHIMMER_SEC}
            onLikeChange={(card, liked) => {
              if (!liked) handleRemoveLook(`look:${card.source}:${card.id}`);
            }}
          />
        )
      ) : null}
    </section>
  );
}
