import type { SupabaseClient } from "@supabase/supabase-js";

import {
  notifyBorrowOverdueAfterStripeCharge,
  notifyUnsentBorrowOverdueStripeCharges,
} from "@/lib/cart/notify-borrow-overdue-after-stripe-charge";
import { settleBorrowOverdueStripeCharges } from "@/lib/stripe/borrow-overdue-penalty-charge";

/** Tente le prélèvement Stripe des jours de pénalité en attente pour un panier emprunt. */
export async function settleCartBorrowOverdueStripe(
  admin: SupabaseClient,
  input: { userId: string; cartId: string; cronSmsNowMs?: number },
): Promise<{ charged: boolean; notified?: boolean; error?: string }> {
  const result = await settleBorrowOverdueStripeCharges(admin, input);
  let notified = false;

  if (result.charged && result.paymentIntentId) {
    try {
      notified = await notifyBorrowOverdueAfterStripeCharge(admin, {
        userId: input.userId,
        cartId: input.cartId,
        paymentIntentId: result.paymentIntentId,
        cronSmsNowMs: input.cronSmsNowMs,
      });
    } catch (e) {
      console.error("[borrow-overdue] notify after stripe", input.cartId, e);
    }
  }

  if (!notified) {
    try {
      notified = await notifyUnsentBorrowOverdueStripeCharges(admin, input);
    } catch (e) {
      console.error("[borrow-overdue] notify unsent stripe charges", input.cartId, e);
    }
  }

  if (result.charged) {
    return { charged: true, notified };
  }

  if (
    result.error === "nothing_to_settle" ||
    result.error === "amount_below_stripe_minimum" ||
    result.error === "stripe_charge_disabled"
  ) {
    return { charged: false, notified: notified || undefined, error: result.error };
  }
  if (result.error) {
    console.info("[borrow-overdue] stripe settle", input.cartId, result.error);
  }
  return { charged: false, notified: notified || undefined, error: result.error };
}
