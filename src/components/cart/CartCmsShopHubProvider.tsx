"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useRouter } from "next/navigation";

import { CmsShopHubFramesProvider, type CmsShopHubFramesEnv } from "@/components/cms/CmsShopHubFramesContext";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import { createSupabaseBrowserClient, isSupabaseAuthLockAbortError } from "@/lib/supabase/client";
import { createSignedUrlForStoragePath } from "@/lib/supabase/storage-resolve-signed-url";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import { useActiveCartItemIds } from "@/hooks/useActiveCartItemIds";
import { CartShopHubUiProvider, type CartShopHubUiValue } from "@/components/cart/CartShopHubUiContext";
import {
  emptyShopCatalogFilters,
  itemSpotlightCoverUrlFromPayload,
  itemSpotlightPhotoPositionFromPayload,
  parseCmsPieceSpotlightFromPayload,
  ShopCapsuleItemRefFrame,
  type ShopCatalogItem,
} from "@/components/shop/ShopCatalog";

const CART_CMS_ITEM_SEARCH_STATE = {
  search: "",
  sortMode: "recent" as const,
  heartsOnly: false,
  disponiblesOnly: false,
  filters: emptyShopCatalogFilters,
};

type CartCmsShopHubProviderProps = {
  catalogItems: ShopCatalogItem[];
  /** Après ajout / retrait panier depuis une carte CMS : re-sync serveur (ex. `router.refresh`). */
  onCartMutation?: () => void;
  children: ReactNode;
};

export function CartCmsShopHubProvider({ catalogItems, onCartMutation, children }: CartCmsShopHubProviderProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const { itemIds: localCartItemIds, refresh: refreshCartItemIds } = useActiveCartItemIds();

  const itemById = useMemo(() => {
    const m = new Map<string, ShopCatalogItem>();
    for (const it of catalogItems) m.set(it.id, it);
    return m;
  }, [catalogItems]);

  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>({});
  const coverResolvedRef = useRef<Set<string>>(new Set());

  const [likedSet, setLikedSet] = useState<Set<string>>(() => new Set());
  const [likeBusyIds, setLikeBusyIds] = useState<Set<string>>(() => new Set());
  const [cartBusyIds, setCartBusyIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await Promise.all(
        catalogItems.map(async (item) => {
          if (coverResolvedRef.current.has(item.id)) return null;
          const path = getFirstPhotoStoragePath(item.photos);
          if (!path) {
            coverResolvedRef.current.add(item.id);
            return null;
          }
          try {
            const url = await createSignedUrlForStoragePath(supabase, path, 60 * 60 * 24);
            if (!url) return null;
            return [item.id, url] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const updates: Record<string, string> = {};
      for (const row of rows) {
        if (!row) continue;
        const [id, url] = row;
        updates[id] = url;
        coverResolvedRef.current.add(id);
      }
      if (Object.keys(updates).length > 0) {
        setCoverUrlById((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogItems, supabase]);

  useEffect(() => {
    let cancelled = false;
    async function syncLikesOnce(): Promise<boolean> {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user || cancelled) return true;
      const { data } = await supabase
        .from("item_favorites")
        .select("item_id")
        .eq("user_id", user.id)
        .is("deleted_at", null);
      if (!cancelled && data) {
        setLikedSet(new Set(data.map((r: { item_id: string }) => r.item_id)));
      }
      return true;
    }

    async function syncLikes() {
      try {
        await syncLikesOnce();
      } catch (e) {
        if (cancelled) return;
        if (!isSupabaseAuthLockAbortError(e)) {
          console.error(e);
          return;
        }
        await new Promise((r) => window.setTimeout(r, 200));
        if (cancelled) return;
        try {
          await syncLikesOnce();
        } catch (e2) {
          if (!cancelled && !isSupabaseAuthLockAbortError(e2)) console.error(e2);
        }
      }
    }

    // Après le microtask de `useActiveCartItemIds.refresh` pour limiter la course sur le verrou token GoTrue.
    const timeoutId = window.setTimeout(() => {
      void syncLikes();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [supabase]);

  const withLikeBusy = useCallback(async (itemId: string, action: () => Promise<void>) => {
    if (likeBusyIds.has(itemId)) return;
    setLikeBusyIds((s) => new Set([...s, itemId]));
    try {
      await action();
    } finally {
      setLikeBusyIds((s) => {
        const next = new Set(s);
        next.delete(itemId);
        return next;
      });
    }
  }, [likeBusyIds]);

  const withCartBusy = useCallback(async (itemId: string, action: () => Promise<void>) => {
    if (cartBusyIds.has(itemId)) return;
    setCartBusyIds((s) => new Set([...s, itemId]));
    try {
      await action();
    } finally {
      setCartBusyIds((s) => {
        const next = new Set(s);
        next.delete(itemId);
        return next;
      });
    }
  }, [cartBusyIds]);

  const getOpenCartId = useCallback(
    async (userId: string, opts?: { createIfMissing?: boolean }) => {
      const { data: existingCart } = await supabase
        .from("carts")
        .select("id,status")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .in("status", [...CART_STATUSES_OPEN])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingCart?.id) return existingCart.id as string;
      if (!opts?.createIfMissing) return null;
      const { data: createdCart } = await supabase
        .from("carts")
        .insert({ user_id: userId, status: "active" })
        .select("id")
        .single();
      return (createdCart?.id as string | undefined) ?? null;
    },
    [supabase],
  );

  const handleToggleLike = useCallback(
    async (itemId: string) => {
      await withLikeBusy(itemId, async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const likedNow = likedSet.has(itemId);
        setLikedSet((prev) => {
          const next = new Set(prev);
          if (likedNow) next.delete(itemId);
          else next.add(itemId);
          return next;
        });

        if (likedNow) {
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
      });
    },
    [likedSet, supabase, withLikeBusy],
  );

  const handleToggleCart = useCallback(
    async (itemId: string) => {
      await withCartBusy(itemId, async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const inCartNow = localCartItemIds.has(itemId);
        if (inCartNow) {
          const cartId = await getOpenCartId(user.id, { createIfMissing: false });
          if (cartId) {
            await supabase
              .from("cart_items")
              .update({ deleted_at: new Date().toISOString() })
              .eq("cart_id", cartId)
              .eq("item_id", itemId)
              .is("deleted_at", null);
          } else {
            await supabase
              .from("cart_items")
              .update({ deleted_at: new Date().toISOString() })
              .eq("owner_user_id", user.id)
              .eq("item_id", itemId)
              .is("deleted_at", null);
          }
        } else {
          const cartId = await getOpenCartId(user.id, { createIfMissing: true });
          if (!cartId) return;

          const { data: existingActive } = await supabase
            .from("cart_items")
            .select("id")
            .eq("cart_id", cartId)
            .eq("item_id", itemId)
            .is("deleted_at", null)
            .limit(1)
            .maybeSingle();
          if (existingActive?.id) return;

          const { data: existingDeleted } = await supabase
            .from("cart_items")
            .select("id")
            .eq("cart_id", cartId)
            .eq("item_id", itemId)
            .not("deleted_at", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingDeleted?.id) {
            await supabase
              .from("cart_items")
              .update({ deleted_at: null, status: "in_cart" })
              .eq("id", existingDeleted.id);
          } else {
            await supabase.from("cart_items").insert({
              cart_id: cartId,
              item_id: itemId,
              owner_user_id: user.id,
              status: "in_cart",
            });
          }
        }

        window.dispatchEvent(new CustomEvent("segna:cart-changed"));
        await refreshCartItemIds();
        onCartMutation?.();
      });
    },
    [getOpenCartId, localCartItemIds, onCartMutation, refreshCartItemIds, supabase, withCartBusy],
  );

  const hubUiValue = useMemo<CartShopHubUiValue>(
    () => ({
      coverUrlById,
      likedSet,
      likeBusyIds,
      cartBusyIds,
      localCartItemIds,
      handleToggleLike,
      handleToggleCart,
      itemById,
    }),
    [
      cartBusyIds,
      coverUrlById,
      handleToggleCart,
      handleToggleLike,
      itemById,
      likeBusyIds,
      likedSet,
      localCartItemIds,
    ],
  );

  const hubEnv = useMemo<CmsShopHubFramesEnv>(
    () => ({
      categories: [],
      brands: [],
      onCategoryFilter: () => router.push("/shop"),
      onBrandFilter: () => router.push("/shop"),
      refsPreferShopNavigation: true,
      renderShopItemRef: (row: CmsFrameRow) => {
        const p = row.payload;
        const id = typeof p.item_id === "string" ? p.item_id.trim() : "";
        const item = id ? itemById.get(id) : undefined;
        if (!item) return null;
        return (
          <ShopCapsuleItemRefFrame
            rowId={row.id}
            item={item}
            cover={coverUrlById[item.id]}
            spotlight={parseCmsPieceSpotlightFromPayload(p)}
            spotlightCoverUrl={itemSpotlightCoverUrlFromPayload(p)}
            spotlightPhotoPosition={itemSpotlightPhotoPositionFromPayload(p)}
            shimmerDurationSec={2.85}
            cartItemIds={localCartItemIds}
            likedSet={likedSet}
            likeBusyIds={likeBusyIds}
            cartBusyIds={cartBusyIds}
            onToggleLike={handleToggleLike}
            onToggleCart={handleToggleCart}
            searchState={CART_CMS_ITEM_SEARCH_STATE}
            itemFromQuery="cart"
            skipCatalogNavigationPersist
          />
        );
      },
    }),
    [
      coverUrlById,
      handleToggleCart,
      handleToggleLike,
      itemById,
      likeBusyIds,
      likedSet,
      cartBusyIds,
      localCartItemIds,
      router,
    ],
  );

  return (
    <CartShopHubUiProvider value={hubUiValue}>
      <CmsShopHubFramesProvider value={hubEnv}>{children}</CmsShopHubFramesProvider>
    </CartShopHubUiProvider>
  );
}
