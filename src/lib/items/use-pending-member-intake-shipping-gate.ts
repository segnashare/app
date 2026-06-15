"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchPendingMemberIntakeShippingGate } from "@/lib/items/member-intake-shipping-pipeline-gate";
import type { PendingMemberIntakeShippingGateSnapshot } from "@/lib/items/member-intake-shipping-pipeline-gate";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const EMPTY_GATE: PendingMemberIntakeShippingGateSnapshot = {
  pendingItemIds: [],
  shipmentsSplit: false,
};

export function usePendingMemberIntakeShippingGate(enabled = true) {
  const [gate, setGate] = useState<PendingMemberIntakeShippingGateSnapshot>(EMPTY_GATE);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setGate(EMPTY_GATE);
      setLoading(false);
      return EMPTY_GATE;
    }
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
    const supabase = createSupabaseBrowserClient() as any;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setGate(EMPTY_GATE);
      setLoading(false);
      return EMPTY_GATE;
    }
    const snapshot = await fetchPendingMemberIntakeShippingGate(supabase, user.id);
    setGate(snapshot);
    setLoading(false);
    return snapshot;
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...gate, loading, refresh };
}
