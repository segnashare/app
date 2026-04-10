import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Après activation d’un abonnement prêteur (côté client) : passe en `shipping` les intakes
 * `awaiting_subscription` et `pre_subscribe_eligible` (parcours proposition) pour l’utilisateur courant.
 * Les webhooks Stripe appellent `promote_pre_subscribe_intakes_to_shipping_for_user` en service_role.
 */
export async function promotePreSubscribeIntakesToShipping(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("promote_pre_subscribe_intakes_to_shipping");
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, result: data as { ok?: boolean; updated?: number; reason?: string } | null };
}
