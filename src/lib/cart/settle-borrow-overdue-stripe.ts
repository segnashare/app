import type { SupabaseClient } from "@supabase/supabase-js";

import { settleBorrowOverdueStripeCharges } from "@/lib/stripe/borrow-overdue-penalty-charge";

/** Tente le prélèvement Stripe des jours de pénalité en attente pour un panier emprunt. */
export async function settleCartBorrowOverdueStripe(
  admin: SupabaseClient,
  input: { userId: string; cartId: string },
): Promise<{ charged: boolean; error?: string }> {
  const result = await settleBorrowOverdueStripeCharges(admin, input);
  if (result.charged) {
    return { charged: true };
  }
  if (
    result.error === "nothing_to_settle" ||
    result.error === "amount_below_stripe_minimum" ||
    result.error === "stripe_charge_disabled"
  ) {
    return { charged: false, error: result.error };
  }
  if (result.error) {
    console.info("[borrow-overdue] stripe settle", input.cartId, result.error);
  }
  return { charged: false, error: result.error };
}
