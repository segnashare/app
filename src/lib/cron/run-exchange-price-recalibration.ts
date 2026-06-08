import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyExchangePriceChanges } from "@/lib/economy/notify-exchange-price-changes";

type RecalibrationResult = {
  day?: string;
  adjusted?: number;
  skipped?: number;
  shadow_would_adjust?: number;
  shadow_mode?: boolean;
};

type PriceHistoryRow = {
  item_id: string;
  old_price_points: number | null;
  new_price_points: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Agrège la demande, recalibre les valeurs d'échange et notifie les membres concernés.
 */
export async function runExchangePriceRecalibration(
  admin: SupabaseClient,
  day: string = new Date().toISOString().slice(0, 10),
): Promise<{
  recalibration: RecalibrationResult;
  changesNotified: number;
  ownersNotified: number;
  borrowersNotified: number;
}> {
  const sinceIso = new Date(Date.now() - 5 * 60_000).toISOString();

  const { data: recalibrationRaw, error: recalErr } = await admin.rpc("recalibrate_exchange_prices", {
    p_day: day,
  });
  if (recalErr) throw new Error(recalErr.message);

  const recalibration = (recalibrationRaw ?? {}) as RecalibrationResult;

  if (recalibration.shadow_mode) {
    return {
      recalibration,
      changesNotified: 0,
      ownersNotified: 0,
      borrowersNotified: 0,
    };
  }

  const { data: historyRows, error: histErr } = await admin
    .from("item_price_history")
    .select("item_id, old_price_points, new_price_points, metadata, created_at")
    .eq("price_type", "exchange")
    .eq("source", "demand_engine")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });

  if (histErr) throw new Error(histErr.message);

  const changes = (historyRows ?? []) as PriceHistoryRow[];
  const notifyResult = await notifyExchangePriceChanges(admin, changes, day);

  return {
    recalibration,
    changesNotified: changes.length,
    ownersNotified: notifyResult.ownersNotified,
    borrowersNotified: notifyResult.borrowersNotified,
  };
}

/**
 * Agrégation quotidienne des signaux demande (sans recalibrage).
 */
export async function runDemandMetricsAggregation(
  admin: SupabaseClient,
  day: string = new Date().toISOString().slice(0, 10),
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("aggregate_item_demand_metrics", { p_day: day });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}
