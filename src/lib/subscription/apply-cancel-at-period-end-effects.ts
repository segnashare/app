import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  declareSubscriptionCancelToN8n,
  periodEndIsoFromStripeSubscription,
} from "@/lib/notifications/notify-ops-activity-n8n";
import { notifySubscriptionCancelScheduled } from "@/lib/notifications/subscription-cancel-notifications";
import { getMappedPlanCodeFromSubscription } from "@/lib/stripe/subscription-state";
import { applySubscriptionCancelToOpenRentals } from "@/lib/subscription/apply-subscription-cancel-to-rentals";

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

  const periodEndIso = periodEndIsoFromStripeSubscription(subscription);
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
    try {
      const planCode = await getMappedPlanCodeFromSubscription(admin, subscription);
      await declareSubscriptionCancelToN8n(admin, {
        userId,
        subscriptionId: subscription.id,
        periodEndIso,
        mode: "at_period_end",
        planCode,
        source: "cancel_at_period_end",
      });
    } catch (e) {
      console.error("[subscription] declare cancel n8n scheduled", e);
    }
  }

  return { periodEndIso, updatedCartIds };
}
