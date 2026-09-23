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

function setupIntentIsPending(value: Stripe.Subscription["pending_setup_intent"]): boolean {
  if (!value) return false;
  if (typeof value === "string") return true;
  return value.status !== "succeeded" && value.status !== "canceled";
}

function invoiceIsPaid(invoice: Stripe.Invoice): boolean {
  return invoice.status === "paid";
}

/**
 * La bienvenue ne doit partir qu’après encaissement (ou facture 0 € réellement close),
 * pas à la création Payment Sheet (`incomplete` / setup encore ouvert).
 */
export async function subscriptionHasCollectedWelcomePayment(
  subscription: Stripe.Subscription,
  stripe?: Stripe,
): Promise<boolean> {
  if (subscription.status !== "active" && subscription.status !== "trialing") return false;
  if (setupIntentIsPending(subscription.pending_setup_intent)) return false;

  let invoice = subscription.latest_invoice;
  if (typeof invoice === "string" && stripe) {
    try {
      invoice = await stripe.invoices.retrieve(invoice);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[notifications] subscription welcome: invoice retrieve failed", msg);
      return false;
    }
  }
  if (invoice && typeof invoice === "object" && !("deleted" in invoice && invoice.deleted)) {
    return invoiceIsPaid(invoice);
  }
  return false;
}

export function stripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as { subscription?: string | { id?: string } | null }).subscription;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (direct && typeof direct === "object" && typeof direct.id === "string" && direct.id.trim()) {
    return direct.id.trim();
  }
  const parent = invoice.parent;
  const fromParent =
    parent && typeof parent === "object"
      ? (parent as { subscription_details?: { subscription?: string | { id?: string } } })
          .subscription_details?.subscription
      : null;
  if (typeof fromParent === "string" && fromParent.trim()) return fromParent.trim();
  if (fromParent && typeof fromParent === "object" && typeof fromParent.id === "string") {
    return fromParent.id.trim() || null;
  }
  return null;
}

/**
 * E-mail de bienvenue Segna X (une fois par abonnement Stripe), après paiement confirmé.
 */
export async function notifySegnaXSubscriptionWelcomeIfApplicable(
  admin: SupabaseClient,
  userId: string,
  subscription: Stripe.Subscription,
  options?: {
    stripe?: Stripe;
    checkoutPaymentStatus?: Stripe.Checkout.Session.PaymentStatus | null;
    invoiceAlreadyPaid?: boolean;
  },
): Promise<void> {
  const planCode = await getMappedPlanCodeFromSubscription(admin, subscription);
  if (planCode !== "segna_x") return;
  if (subscription.status !== "active" && subscription.status !== "trialing") return;
  if (setupIntentIsPending(subscription.pending_setup_intent)) return;

  const checkoutStatus = options?.checkoutPaymentStatus;
  if (
    checkoutStatus &&
    checkoutStatus !== "paid" &&
    checkoutStatus !== "no_payment_required"
  ) {
    return;
  }

  const paid =
    options?.invoiceAlreadyPaid === true ||
    (await subscriptionHasCollectedWelcomePayment(subscription, options?.stripe));
  if (!paid) return;

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
