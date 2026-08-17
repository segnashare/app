import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { resolveStripeCustomerPaymentMethod } from "@/lib/stripe/stripe-customer-payment-method";

type AdminClient = SupabaseClient;

export type CartOffSessionChargeResult =
  | { ok: true; paymentIntent: Stripe.PaymentIntent }
  | {
      ok: false;
      reason: string;
      /** PI à présenter on-session (3DS) — ne pas en créer un nouveau. */
      paymentIntent?: Stripe.PaymentIntent;
    };

function paymentIntentFromStripeError(e: unknown): Stripe.PaymentIntent | null {
  if (!e || typeof e !== "object" || !("payment_intent" in e)) return null;
  const pi = (e as { payment_intent?: Stripe.PaymentIntent | string }).payment_intent;
  if (pi && typeof pi === "object" && typeof pi.id === "string" && pi.client_secret) {
    return pi;
  }
  return null;
}

/**
 * Prélève la carte enregistrée (off-session) pour un panier.
 * Échec (3DS, refus, pas de PM) → le caller ouvre Payment Sheet / Checkout.
 * Si 3DS requis : renvoie le PI existant (carte déjà attachée) pour auth on-session.
 */
export async function tryChargeCartOrderOffSession(params: {
  stripe: Stripe;
  admin: AdminClient;
  userId: string;
  amountCents: number;
  metadata: Stripe.MetadataParam;
  description: string;
}): Promise<CartOffSessionChargeResult> {
  const amount = Math.max(0, Math.trunc(params.amountCents));
  if (amount < 50) {
    return { ok: false, reason: "amount_below_minimum" };
  }

  const pm = await resolveStripeCustomerPaymentMethod(
    params.stripe,
    params.admin,
    params.userId,
  );
  if (!pm.ok) {
    return { ok: false, reason: pm.error };
  }

  try {
    const paymentIntent = await params.stripe.paymentIntents.create({
      amount,
      currency: "eur",
      customer: pm.customerId,
      payment_method: pm.paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: params.metadata,
      description: params.description,
    });

    if (paymentIntent.status === "succeeded") {
      return { ok: true, paymentIntent };
    }

    // 3DS / confirmation client : garder le PI (PM déjà attachée) pour Payment Sheet.
    if (
      paymentIntent.status === "requires_action" ||
      paymentIntent.status === "requires_confirmation"
    ) {
      return {
        ok: false,
        reason: `payment_intent_${paymentIntent.status}`,
        paymentIntent,
      };
    }

    if (paymentIntent.status === "requires_payment_method") {
      try {
        await params.stripe.paymentIntents.cancel(paymentIntent.id);
      } catch {
        /* best effort */
      }
    }

    return { ok: false, reason: `payment_intent_${paymentIntent.status}` };
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code?: unknown }).code ?? "").trim()
        : "";
    const errPi = paymentIntentFromStripeError(e);

    // Banque exige une auth : ne pas annuler — le client finalise on-session.
    if (
      errPi &&
      (code === "authentication_required" ||
        errPi.status === "requires_action" ||
        errPi.status === "requires_confirmation")
    ) {
      console.warn("[cart-checkout] off_session needs on-session auth", code || errPi.status);
      return {
        ok: false,
        reason: code || `payment_intent_${errPi.status}`,
        paymentIntent: errPi,
      };
    }

    if (errPi?.id) {
      try {
        await params.stripe.paymentIntents.cancel(errPi.id);
      } catch {
        /* best effort */
      }
    }

    if (code) {
      console.warn("[cart-checkout] off_session charge failed", code);
      return { ok: false, reason: code };
    }
    const msg = e instanceof Error ? e.message : "charge_failed";
    console.warn("[cart-checkout] off_session charge failed", msg);
    return { ok: false, reason: "charge_failed" };
  }
}
