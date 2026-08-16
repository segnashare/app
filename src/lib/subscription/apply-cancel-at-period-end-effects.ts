import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { notifySubscriptionCancelScheduled } from "@/lib/notifications/subscription-cancel-notifications";
import { applySubscriptionCancelToOpenRentals } from "@/lib/subscription/apply-subscription-cancel-to-rentals";

function periodEndIsoFromSubscription(subscription: Stripe.Subscription): string | null {
  const firstItem = subscription.items.data[0];
  const unix = firstItem?.current_period_end ?? null;
  if (!unix || unix <= 0) return null;
  return new Date(unix * 1000).toISOString();
}

/**
 * Effets métier quand `cancel_at_period_end` passe à true (membre ou portail Stripe).
 */
export async function applySubscriptionCancelAtPeriodEndEffects(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
  opts?: { notify?: boolean },
): Promise<{ periodEndIso: string | null; updatedCartIds: string[] }> {
  if (!subscription.cancel_at_period_end) {
    return { periodEndIso: null, updatedCartIds: [] };
  }
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    return { periodEndIso: null, updatedCartIds: [] };
  }

  const periodEndIso = periodEndIsoFromSubscription(subscription);
  if (!periodEndIso) return { periodEndIso: null, updatedCartIds: [] };

  const { updatedCartIds } = await applySubscriptionCancelToOpenRentals(admin, userId, periodEndIso);

  if (opts?.notify !== false) {
    try {
      await notifySubscriptionCancelScheduled(admin, {
        userId,
        subscriptionId: subscription.id,
        periodEndIso,
        updatedCartCount: updatedCartIds.length,
      });
    } catch (e) {
      console.error("[subscription] notify cancel scheduled", e);
    }
  }

  return { periodEndIso, updatedCartIds };
}
