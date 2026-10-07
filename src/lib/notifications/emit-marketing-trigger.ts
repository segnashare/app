import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { dispatchLikedItemAvailableRules } from "@/lib/notifications/notification-rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const ITEM_FAVORITE_TRIGGERS = new Set(["liked_item_available", "item_available"]);

export type MarketingTriggerContext = {
  itemId?: string;
  itemLabel?: string;
  ownerUserId?: string | null;
  cartId?: string;
  orderId?: string;
  marqueItem?: string;
  etape?: string;
  nbPieces?: string;
};

/**
 * Point d’entrée unique pour déclencher les règles marketing BO.
 * Fire-and-forget safe : erreurs loguées, jamais jetées au caller.
 *
 * Item favoris → `dispatchLikedItemAvailableRules`.
 * Triggers user-scoped (cart, onboarding, …) : acceptés côté API, no-op tant
 * que le dispatcher générique n’est pas branché dans `notification-rules`.
 */
export async function emitMarketingTrigger(
  admin: SupabaseClient,
  input: {
    triggerEvent: string;
    userId?: string | null;
    vars?: Record<string, string>;
    idempotencySuffix: string;
    context?: MarketingTriggerContext;
  },
): Promise<void> {
  try {
    if (ITEM_FAVORITE_TRIGGERS.has(input.triggerEvent)) {
      const itemId = input.context?.itemId?.trim() ?? "";
      const itemLabel = input.context?.itemLabel?.trim() || input.vars?.nom_item || "Pièce";
      if (!itemId) return;
      await dispatchLikedItemAvailableRules(admin, {
        itemId,
        itemLabel,
        ownerUserId: input.context?.ownerUserId ?? null,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] emitMarketingTrigger", input.triggerEvent, msg);
  }
}

/** Variante sans client admin déjà ouvert (hooks analytics / client API). */
export async function emitMarketingTriggerWithAdmin(input: {
  triggerEvent: string;
  userId?: string | null;
  vars?: Record<string, string>;
  idempotencySuffix: string;
  context?: MarketingTriggerContext;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  await emitMarketingTrigger(admin, input);
}
