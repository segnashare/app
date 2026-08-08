import type Stripe from "stripe";

function resolvePaymentIntentId(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === "string") return pi.trim() || null;
  if (pi && typeof pi === "object" && "id" in pi) {
    const id = String((pi as { id: string }).id).trim();
    return id || null;
  }
  return null;
}

function resolvePaymentMethodId(paymentIntent: Stripe.PaymentIntent): string | null {
  const pm = paymentIntent.payment_method;
  if (typeof pm === "string") return pm.trim() || null;
  if (pm && typeof pm === "object" && "id" in pm) {
    const id = String((pm as { id: string }).id).trim();
    return id || null;
  }
  return null;
}

function resolveSetupIntentId(session: Stripe.Checkout.Session): string | null {
  const si = session.setup_intent;
  if (typeof si === "string") return si.trim() || null;
  if (si && typeof si === "object" && "id" in si) {
    const id = String((si as { id: string }).id).trim();
    return id || null;
  }
  return null;
}

async function persistPaymentMethodOnCustomer(
  stripe: Stripe,
  customerId: string,
  paymentMethodId: string,
): Promise<void> {
  try {
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const attachedCustomer =
      typeof pm.customer === "string" ? pm.customer : pm.customer && typeof pm.customer === "object" ? pm.customer.id : null;
    if (!attachedCustomer) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } else if (attachedCustomer !== customerId) {
      return;
    }

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  } catch (e) {
    console.error("[stripe] persist default PM", customerId, paymentMethodId, e);
  }
}

/**
 * Après un Checkout `mode: payment`, enregistre la carte sur le client Stripe
 * pour les prélèvements off-session (pénalités retard emprunt, etc.).
 */
export async function persistStripeCustomerDefaultPaymentMethodFromCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "payment") return;
  if (session.payment_status !== "paid") return;

  const customerId = typeof session.customer === "string" ? session.customer.trim() : "";
  if (!customerId) return;

  const paymentIntentId = resolvePaymentIntentId(session);
  if (!paymentIntentId) return;

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    console.error("[stripe] persist default PM: retrieve PI", paymentIntentId, e);
    return;
  }

  const paymentMethodId = resolvePaymentMethodId(paymentIntent);
  if (!paymentMethodId) return;

  await persistPaymentMethodOnCustomer(stripe, customerId, paymentMethodId);
}

/** Après Payment Sheet réussi — même persistance de PM par défaut. */
export async function persistStripeCustomerDefaultPaymentMethodFromPaymentIntent(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  if (paymentIntent.status !== "succeeded") return;
  const customerId = typeof paymentIntent.customer === "string" ? paymentIntent.customer.trim() : "";
  if (!customerId) return;
  const paymentMethodId = resolvePaymentMethodId(paymentIntent);
  if (!paymentMethodId) return;
  await persistPaymentMethodOnCustomer(stripe, customerId, paymentMethodId);
}

/** Après SetupIntent (Payment Sheet panier 0 €), enregistre la carte par défaut. */
export async function persistStripeCustomerDefaultPaymentMethodFromSetupIntent(
  stripe: Stripe,
  setupIntent: Stripe.SetupIntent,
): Promise<void> {
  if (setupIntent.status !== "succeeded") return;
  const customerId = typeof setupIntent.customer === "string" ? setupIntent.customer.trim() : "";
  if (!customerId) return;
  const pm = setupIntent.payment_method;
  const paymentMethodId =
    typeof pm === "string" ? pm.trim() : pm && typeof pm === "object" ? String(pm.id).trim() : "";
  if (!paymentMethodId) return;
  await persistPaymentMethodOnCustomer(stripe, customerId, paymentMethodId);
}

/**
 * Après un Checkout `mode: setup` (réservation panier 0 €), enregistre la carte
 * pour les prélèvements off-session futurs.
 */
export async function persistStripeCustomerDefaultPaymentMethodFromSetupSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "setup") return;
  if (session.status !== "complete") return;

  const customerId = typeof session.customer === "string" ? session.customer.trim() : "";
  if (!customerId) return;

  const setupIntentId = resolveSetupIntentId(session);
  if (!setupIntentId) return;

  let setupIntent: Stripe.SetupIntent;
  try {
    setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  } catch (e) {
    console.error("[stripe] persist default PM: retrieve SI", setupIntentId, e);
    return;
  }

  const pm = setupIntent.payment_method;
  const paymentMethodId =
    typeof pm === "string" ? pm.trim() : pm && typeof pm === "object" ? String(pm.id).trim() : "";
  if (!paymentMethodId) return;

  await persistPaymentMethodOnCustomer(stripe, customerId, paymentMethodId);
}

/** Checkout payment ou setup : persiste la carte par défaut si applicable. */
export async function persistStripeCustomerDefaultPaymentMethodFromCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode === "payment") {
    await persistStripeCustomerDefaultPaymentMethodFromCheckout(stripe, session);
    return;
  }
  if (session.mode === "setup") {
    await persistStripeCustomerDefaultPaymentMethodFromSetupSession(stripe, session);
  }
}
