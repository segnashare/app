import type { SupabaseClient } from "@supabase/supabase-js";

import { borrowDueAtFromPeriodEnd } from "@/lib/subscription/borrow-due-from-period-end";

type OpenRentalCart = {
  id: string;
  borrow_return_due_at: string | null;
  checkout_borrow_duration_days: number | null;
  checkout_purchase_mode: boolean | null;
  status: string;
};

/**
 * Paniers location ouverts : la fin d’abonnement devient le dernier jour de location
 * (clamp si une échéance plus lointaine existait déjà ; pose l’échéance si absente).
 */
export async function applySubscriptionCancelToOpenRentals(
  admin: SupabaseClient,
  userId: string,
  periodEndIso: string,
): Promise<{ updatedCartIds: string[] }> {
  const dueAt = borrowDueAtFromPeriodEnd(periodEndIso);
  const dueMs = Date.parse(dueAt);

  const { data, error } = await admin
    .from("carts")
    .select("id, borrow_return_due_at, checkout_borrow_duration_days, checkout_purchase_mode, status")
    .eq("user_id", userId)
    .in("status", ["confirmed", "disputed"])
    .or("checkout_purchase_mode.is.null,checkout_purchase_mode.eq.false");

  if (error) {
    console.error("[subscription] applyCancelToOpenRentals", error.message);
    return { updatedCartIds: [] };
  }

  const rows = (data ?? []) as OpenRentalCart[];
  const updatedCartIds: string[] = [];

  for (const cart of rows) {
    if (cart.checkout_purchase_mode === true) continue;

    const existingMs =
      typeof cart.borrow_return_due_at === "string" && cart.borrow_return_due_at.trim()
        ? Date.parse(cart.borrow_return_due_at)
        : Number.NaN;

    // Garder une échéance déjà plus courte ; sinon figer à la fin d’abo.
    if (Number.isFinite(existingMs) && existingMs <= dueMs) continue;

    const patch: Record<string, unknown> = {
      borrow_return_due_at: dueAt,
      updated_at: new Date().toISOString(),
    };

    // Affichage « Location Nj » plutôt que « Location » illimitée.
    if (cart.checkout_borrow_duration_days == null) {
      patch.checkout_borrow_duration_days = Math.max(
        1,
        Math.ceil((dueMs - Date.now()) / 86_400_000),
      );
    }

    const { error: updErr } = await admin.from("carts").update(patch).eq("id", cart.id);
    if (updErr) {
      console.error("[subscription] cart due clamp failed", cart.id, updErr.message);
      continue;
    }
    updatedCartIds.push(cart.id);
  }

  return { updatedCartIds };
}
