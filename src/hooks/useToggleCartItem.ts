"use client";

import { useCallback, useMemo, useState } from "react";

import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import { trackClientEvent } from "@/lib/analytics/track-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useActiveCartItemIds } from "@/hooks/useActiveCartItemIds";

async function getOpenCartId(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  userId: string,
  opts?: { createIfMissing?: boolean },
): Promise<string | null> {
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
  const { data: createdCart } = await supabase.from("carts").insert({ user_id: userId, status: "active" }).select("id").single();
  return (createdCart?.id as string | undefined) ?? null;
}

/** Ajout / retrait panier (même logique que le catalogue shop). */
export function useToggleCartItem() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { itemIds: cartItemIds, refresh: refreshCartItemIds } = useActiveCartItemIds();
  const [cartBusyIds, setCartBusyIds] = useState<Set<string>>(() => new Set());

  const toggleCart = useCallback(
    async (itemId: string) => {
      if (cartBusyIds.has(itemId)) return;
      setCartBusyIds((s) => new Set([...s, itemId]));
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const inCartNow = cartItemIds.has(itemId);
        if (inCartNow) {
          const cartId = await getOpenCartId(supabase, user.id, { createIfMissing: false });
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
          const cartId = await getOpenCartId(supabase, user.id, { createIfMissing: true });
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
            await supabase.from("cart_items").update({ deleted_at: null, status: "in_cart" }).eq("id", existingDeleted.id);
          } else {
            await supabase.from("cart_items").insert({
              cart_id: cartId,
              item_id: itemId,
              owner_user_id: user.id,
              status: "in_cart",
            });
          }
          trackClientEvent("cart_item_added", {
            item_id: itemId,
            cart_id: cartId,
            source: "toggle_hook",
          });
        }

        window.dispatchEvent(new CustomEvent("segna:cart-changed"));
        await refreshCartItemIds();
      } finally {
        setCartBusyIds((s) => {
          const next = new Set(s);
          next.delete(itemId);
          return next;
        });
      }
    },
    [cartBusyIds, cartItemIds, refreshCartItemIds, supabase],
  );

  return { cartItemIds, cartBusyIds, toggleCart };
}
