"use client";

import Link from "next/link";
import { ChevronRight, Heart, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { useToggleCartItem } from "@/hooks/useToggleCartItem";
import type { InspirationCompanionRef } from "@/lib/community/types";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type InspirationLinkedItemsRailProps = {
  companions: InspirationCompanionRef[];
  companionItems: ShopCatalogItem[];
  initialCoverUrlById?: Record<string, string>;
  initialFavoriteIds?: string[];
};

function companionRoleLabel(companion: InspirationCompanionRef, item: ShopCatalogItem): string | null {
  if (companion.role_label?.trim()) return companion.role_label.trim();
  if (item.category_label?.trim()) return item.category_label.trim();
  return null;
}

export function InspirationLinkedItemsRail({
  companions,
  companionItems,
  initialCoverUrlById = {},
  initialFavoriteIds = [],
}: InspirationLinkedItemsRailProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { cartItemIds, cartBusyIds, toggleCart } = useToggleCartItem();
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>(initialCoverUrlById);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(initialFavoriteIds));

  const availableCompanions = useMemo(() => {
    const byId = new Map(companionItems.map((item) => [item.id, item]));
    return companions
      .map((companion) => {
        const item = byId.get(companion.item_id);
        if (!item) return null;
        return { companion, item };
      })
      .filter((row): row is { companion: InspirationCompanionRef; item: ShopCatalogItem } => row !== null);
  }, [companionItems, companions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pathByItemId = new Map<string, string>();
      for (const { item } of availableCompanions) {
        if (coverUrlById[item.id]) continue;
        const path = getFirstPhotoStoragePath(item.photos);
        if (!path) continue;
        pathByItemId.set(item.id, path);
      }
      if (pathByItemId.size === 0) return;
      const signedByPath = await createSignedUrlsForStoragePaths(supabase, [...pathByItemId.values()], 60 * 60 * 24);
      if (cancelled) return;
      const updates: Record<string, string> = {};
      for (const [id, path] of pathByItemId) {
        const url = signedByPath.get(path);
        if (url) updates[id] = url;
      }
      if (Object.keys(updates).length > 0) {
        setCoverUrlById((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [availableCompanions, coverUrlById, supabase]);

  async function toggleFavorite(itemId: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const isFav = favoriteIds.has(itemId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

    if (isFav) {
      await supabase
        .from("item_favorites")
        .update({ deleted_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("item_id", itemId)
        .is("deleted_at", null);
      return;
    }

    const { data: existingAny } = await supabase
      .from("item_favorites")
      .select("id,deleted_at")
      .eq("user_id", user.id)
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingAny?.id) {
      await supabase.from("item_favorites").update({ deleted_at: null }).eq("id", existingAny.id);
    } else {
      await supabase.from("item_favorites").insert({ user_id: user.id, item_id: itemId });
    }
  }

  if (availableCompanions.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className={cn(SEGNA_SECTION_TITLE_CLASSNAME, segnaPlayfairDisplay.className)}>Pièces de l’inspi</h2>
      <ul className="space-y-3">
        {availableCompanions.map(({ companion, item }) => {
          const role = companionRoleLabel(companion, item);
          const inCart = cartItemIds.has(item.id);
          const cartBusy = cartBusyIds.has(item.id);
          const isFav = favoriteIds.has(item.id);
          const canCart = item.status === "available" || item.status === "in_cart";

          return (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"
            >
              <Link href={`/items/${item.id}?from=community`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                <RemoteCoverThumb photoUrl={coverUrlById[item.id] ?? ""} frameClassName="h-full w-full" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/items/${item.id}?from=community`} className="block truncate text-[14px] font-semibold text-zinc-900">
                  {item.title}
                </Link>
                {role ? <p className="truncate text-[12px] text-zinc-500">{role}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void toggleFavorite(item.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white"
                  aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
                >
                  <Heart className={cn("h-4 w-4", isFav && "fill-rose-500 text-rose-500")} />
                </button>
                {canCart ? (
                  <button
                    type="button"
                    disabled={cartBusy}
                    onClick={() => void toggleCart(item.id)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border",
                      inCart ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-900",
                    )}
                    aria-label={inCart ? "Retirer du panier" : "Ajouter au panier"}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                ) : (
                  <Link
                    href={`/items/${item.id}?from=community`}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white"
                    aria-label="Voir la pièce"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
