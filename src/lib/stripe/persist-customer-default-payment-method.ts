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
