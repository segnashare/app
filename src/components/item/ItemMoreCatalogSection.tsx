"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ShopCatalogGridItemCard, type ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { useToggleCartItem } from "@/hooks/useToggleCartItem";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";
import { cn } from "@/lib/utils/cn";

type ItemMoreCatalogSectionProps = {
  items: ShopCatalogItem[];
  initialCoverUrlById?: Record<string, string>;
};

export function ItemMoreCatalogSection({
  items,
  initialCoverUrlById = {},
}: ItemMoreCatalogSectionProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { cartItemIds, cartBusyIds, toggleCart } = useToggleCartItem();
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>(initialCoverUrlById);
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const [likeBusyIds, setLikeBusyIds] = useState<Set<string>>(new Set());
  const [cartBusyIdsLocal, setCartBusyIdsLocal] = useState<Set<string>>(new Set());

  const visibleItems = useMemo(
    () => items.filter((item) => item.status === "available" || item.status === "in_cart"),
    [items],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pathByItemId = new Map<string, string>();
      for (const item of visibleItems) {
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
  }, [coverUrlById, supabase, visibleItems]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("item_favorites")
        .select("item_id")
        .eq("user_id", user.id)
        .is("deleted_at", null);
      if (!cancelled && data) {
        setLikedSet(new Set(data.map((row: { item_id: string }) => row.item_id)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

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

  const withCartBusy = useCallback(async (itemId: string, action: () => Promise<void>) => {
    if (cartBusyIdsLocal.has(itemId) || cartBusyIds.has(itemId)) return;
    setCartBusyIdsLocal((current) => new Set([...current, itemId]));
    try {
      await action();
    } finally {
      setCartBusyIdsLocal((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  }, [cartBusyIds, cartBusyIdsLocal]);

  const handleToggleLike = useCallback(
    async (targetItemId: string) => {
      await withLikeBusy(targetItemId, async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const likedNow = likedSet.has(targetItemId);
        setLikedSet((current) => {
          const next = new Set(current);
          if (likedNow) next.delete(targetItemId);
          else next.add(targetItemId);
          return next;
        });

        if (likedNow) {
          await supabase
            .from("item_favorites")
            .update({ deleted_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .eq("item_id", targetItemId)
            .is("deleted_at", null);
          return;
        }

        const { data: existingAny } = await supabase
          .from("item_favorites")
          .select("id")
          .eq("user_id", user.id)
          .eq("item_id", targetItemId)
          .maybeSingle();

        if (existingAny?.id) {
          await supabase.from("item_favorites").update({ deleted_at: null }).eq("id", existingAny.id);
        } else {
          await supabase.from("item_favorites").insert({ user_id: user.id, item_id: targetItemId });
        }
      });
    },
    [likedSet, supabase, withLikeBusy],
  );

  const handleToggleCart = useCallback(
    async (targetItemId: string) => {
      await withCartBusy(targetItemId, async () => {
        await toggleCart(targetItemId);
      });
    },
    [toggleCart, withCartBusy],
  );

  const mergedCartBusyIds = useMemo(() => {
    const next = new Set(cartBusyIds);
    for (const id of cartBusyIdsLocal) next.add(id);
    return next;
  }, [cartBusyIds, cartBusyIdsLocal]);

  if (visibleItems.length === 0) return null;

  return (
    <section aria-label="Mais encore" className="pt-6 pb-6">
      <div className="px-6 pb-3">
        <h3 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
          Mais encore...
        </h3>
      </div>

      <ul className="grid grid-cols-2 gap-3 px-6">
        {visibleItems.map((item) => {
          const canAddToCart = item.status === "available" || item.status === "in_cart";
          const inCart = cartItemIds.has(item.id);
          const liked = likedSet.has(item.id);

          return (
            <li key={item.id}>
              <ShopCatalogGridItemCard
                item={item}
                cover={coverUrlById[item.id]}
                shimmerDurationSec={2.85}
                canAddToCart={canAddToCart}
                inCart={inCart}
                liked={liked}
                likeBusyIds={likeBusyIds}
                cartBusyIds={mergedCartBusyIds}
                onToggleLike={handleToggleLike}
                onToggleCart={handleToggleCart}
                onNavigate={() => undefined}
                itemFromQuery="item"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
