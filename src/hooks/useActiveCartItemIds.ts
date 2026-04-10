"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import { createSupabaseBrowserClient, isSupabaseAuthLockAbortError } from "@/lib/supabase/client";

/** IDs des pièces présentes dans le panier actif / réservé (même logique que le compteur panier). */
export function useActiveCartItemIds() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [itemIds, setItemIds] = useState<Set<string>>(() => new Set());

  const refresh = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) {
        setItemIds(new Set());
        return;
      }
      const { data: activeCart } = await supabase
        .from("carts")
        .select("id")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .in("status", [...CART_STATUSES_OPEN])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!activeCart?.id) {
        setItemIds(new Set());
        return;
      }
      const { data: rows, error } = await supabase
        .from("cart_items")
        .select("item_id")
        .eq("cart_id", activeCart.id)
        .is("deleted_at", null);
      if (error || !rows) {
        setItemIds(new Set());
        return;
      }
      const next = new Set<string>();
      for (const row of rows as { item_id?: string | null }[]) {
        if (typeof row.item_id === "string") next.add(row.item_id);
      }
      setItemIds(next);
    } catch (e) {
      if (isSupabaseAuthLockAbortError(e)) return;
      setItemIds(new Set());
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    const onCartChanged = () => void refresh();
    window.addEventListener("segna:cart-changed", onCartChanged as EventListener);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("segna:cart-changed", onCartChanged as EventListener);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { itemIds, refresh };
}
