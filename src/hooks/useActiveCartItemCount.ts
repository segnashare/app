"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function useActiveCartItemCount() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCount(0);
      return;
    }
    const { data: activeCart } = await supabase
      .from("carts")
      .select("id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .in("status", ["active", "reserved"])
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

  return { count, refresh };
}
