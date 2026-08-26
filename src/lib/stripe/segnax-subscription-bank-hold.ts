import type Stripe from "stripe";

/** Empreinte bancaire SegnaX (autorisation manuelle, non capturée). */
export const SEGNAX_BANK_HOLD_AMOUNT_CENTS = 10_000;

function resolvePaymentMethodId(
  value: string | Stripe.PaymentMethod | null | undefined,
): string | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id || null;
  }
  if (value && typeof value === "object" && "id" in value) {
    const id = String(value.id).trim();
    return id || null;
  }
  return null;
}

async function resolveSubscriptionPaymentMethodId(
  stripe: Stripe,
  customerId: string,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const fromSub = resolvePaymentMethodId(subscription.default_payment_method);
  if (fromSub) return fromSub;

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return null;

  const fromCustomer = resolvePaymentMethodId(customer.invoice_settings?.default_payment_method);
  if (fromCustomer) return fromCustomer;

  const listed = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
  return listed.data[0]?.id ?? null;
}

/**
 * Crée une empreinte bancaire (PaymentIntent `capture_method: manual`) après checkout SegnaX.
 * Idempotent via `subscription.metadata.bank_hold_payment_intent_id`.
 * `session` optionnel : Payment Sheet in-app n’a pas de Checkout Session.
 */
export async function createSegnaXSubscriptionBankHoldIfNeeded(params: {
  stripe: Stripe;
  session?: Stripe.Checkout.Session | null;
  subscription: Stripe.Subscription;
  userId: string;
  customerId: string;
}): Promise<{ paymentIntentId: string } | null> {
  const { stripe, session, subscription, userId, customerId } = params;

  const holdCentsRaw =
    session?.metadata?.bank_hold_amount_cents ?? subscription.metadata?.bank_hold_amount_cents ?? "";
  const holdCents = Number.parseInt(String(holdCentsRaw).trim(), 10);
  if (!Number.isFinite(holdCents) || holdCents !== SEGNAX_BANK_HOLD_AMOUNT_CENTS) {
    return null;
  }

  const existingHoldId = subscription.metadata?.bank_hold_payment_intent_id?.trim();
  if (existingHoldId) {
    return { paymentIntentId: existingHoldId };
  }

  const paymentMethodId = await resolveSubscriptionPaymentMethodId(stripe, customerId, subscription);
  if (!paymentMethodId) {
    console.error("[stripe] segnax bank hold: no payment method", { userId, subscriptionId: subscription.id });
    return null;
  }

  const sessionId = session?.id?.trim() || null;
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: SEGNAX_BANK_HOLD_AMOUNT_CENTS,
      currency: "eur",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: "manual",
      confirm: true,
      off_session: true,
      description: "Empreinte bancaire SegnaX",
      metadata: {
        user_id: userId,
        plan_code: "segna_x",
        kind: "segnax_bank_hold",
        ...(sessionId ? { stripe_checkout_session_id: sessionId } : {}),
        stripe_subscription_id: subscription.id,
      },
    },
    {
      idempotencyKey: sessionId
        ? `segnax_bank_hold:${sessionId}`
        : `segnax_bank_hold:sub:${subscription.id}`,
    },
  );

  await stripe.subscriptions.update(subscription.id, {
    metadata: {
      ...subscription.metadata,
      bank_hold_amount_cents: String(SEGNAX_BANK_HOLD_AMOUNT_CENTS),
      bank_hold_payment_intent_id: paymentIntent.id,
      bank_hold_status: paymentIntent.status,
    },
  });

  return { paymentIntentId: paymentIntent.id };
}
