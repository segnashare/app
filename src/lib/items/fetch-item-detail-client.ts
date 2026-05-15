import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { fetchItemDetailPayloadForUser, type FetchItemDetailResult } from "@/lib/items/fetch-item-detail-core";

export type { FetchItemDetailResult, ItemDetailPayload, ItemIntakeSnapshot } from "@/lib/items/fetch-item-detail-core";

/**
 * Charge la fiche pièce si l’utilisateur peut la lire (RLS : catalogue in_cart / available / reserved, ou propriétaire).
 * Intake / outtake : requêtes séparées réservées au propriétaire (RLS sur les embeds).
 */
export async function fetchItemDetailDataForOwner(itemId: string): Promise<FetchItemDetailResult> {
  if (!itemId.trim()) return { ok: false, kind: "not_found" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client typé généré ; chaîne identique au core
  const supabase = createSupabaseBrowserClient() as any;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return { ok: false, kind: "auth" };

  return fetchItemDetailPayloadForUser(supabase, user.id, itemId);
}
