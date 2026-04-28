"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import { createSupabaseBrowserClient, isSupabaseAuthLockAbortError } from "@/lib/supabase/client";

export function useActiveCartItemCount() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const maxAttempts = 5;
    const baseDelayMs = 45;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        if (!user) {
          setCount(0);
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
          setCount(0);
          return;
        }
        const { count: rowCount, error } = await supabase
          .from("cart_items")
          .select("id", { count: "exact", head: true })
          .eq("cart_id", activeCart.id)
          .is("deleted_at", null);
        if (error) {
          setCount(0);
          return;
        }
        setCount(rowCount ?? 0);
        return;
      } catch (e) {
        if (isSupabaseAuthLockAbortError(e) && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, baseDelayMs + attempt * 55));
          continue;
        }
        if (!isSupabaseAuthLockAbortError(e)) {
          setCount(0);
        }
        return;
      }
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    return () => subscription.unsubscribe();
  }, [supabase, refresh]);

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

  return { count, refresh };
}
