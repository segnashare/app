import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * RPC historique : la base ne dépend plus d’un passage par abonnement pour l’expédition.
 */
export async function promotePreSubscribeIntakesToShipping(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("promote_pre_subscribe_intakes_to_shipping");
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, result: data as { ok?: boolean; updated?: number; reason?: string } | null };
}
