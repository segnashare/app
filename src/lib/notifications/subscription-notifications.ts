import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { segnaXWelcomeEmailBlocks } from "@/lib/notifications/email-html";
import { claimNotificationSend, releaseNotificationSend, setNotificationDeliveryChannels } from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import { sendTransactionalEmail } from "@/lib/notifications/resend-send";
import { getMappedPlanCodeFromSubscription } from "@/lib/stripe/subscription-state";

async function loadUserContact(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("users").select("email, phone, first_name").eq("id", userId).maybeSingle();

  if (error) {
    console.error("[notifications] loadUserContact (subscription)", error.message);
    return null;
  }
  return data;
}

function firstNameOrBonjour(firstName: string | null | undefined): string {
  const t = firstName?.trim();
  if (t) return t;
  return "Bonjour";
}

/**
 * E-mail de bienvenue Segna X (une fois par abonnement Stripe), lorsque le plan mappé est `segna_x` et le statut actif ou en essai.
 */
export async function notifySegnaXSubscriptionWelcomeIfApplicable(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const planCode = await getMappedPlanCodeFromSubscription(admin, subscription);
  if (planCode !== "segna_x") return;
  if (subscription.status !== "active" && subscription.status !== "trialing") return;

  const idempotencyKey = `txn:subscription_segna_x_welcome:${subscription.id}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionSegnaXWelcome,
    userId,
    metadata: {
      stripe_subscription_id: subscription.id,
      status: subscription.status,
    },
  });
  if (!claimed) return;

  const user = await loadUserContact(admin, userId);
  const prenom = firstNameOrBonjour(user?.first_name ?? null);
  const { text, html } = segnaXWelcomeEmailBlocks(prenom);
  const subject = "Bienvenue dans Segna X";

  try {
    const email = user?.email?.trim();
    if (!email) {
      console.warn("[notifications] subscription_segna_x: pas d’e-mail utilisateur", { userId });
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }

    const sent = await sendTransactionalEmail({
      to: email,
      subject,
      text,
      html,
      idempotencyKey,
    });
    if (!sent) {
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }
    await setNotificationDeliveryChannels(admin, idempotencyKey, "email");
  } catch (e) {
    await releaseNotificationSend(admin, idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] subscription_segna_x send failed", msg);
  }
}
