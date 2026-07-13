import type Stripe from "stripe";

/** URL PDF reçu Stripe (`receipt_url` + `/pdf?s=ap`). */
export function stripeChargeReceiptPdfUrl(receiptUrl: string): string | null {
  const base = receiptUrl.trim().split("?")[0]?.trim() ?? "";
  if (!base) return null;
  return `${base}/pdf?s=ap`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchStripeReceiptPdfBuffer(pdfUrl: string): Promise<Buffer | null> {
  const url = pdfUrl.trim();
  if (!url) return null;

  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.error("[stripe-receipt-pdf] fetch failed", res.status, url);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 128 || buf.subarray(0, 4).toString("ascii") !== "%PDF") {
      console.error("[stripe-receipt-pdf] invalid pdf payload", buf.length, url);
      return null;
    }
    return buf;
  } catch (e) {
    console.error("[stripe-receipt-pdf] fetch error", url, e);
    return null;
  }
}

async function fetchReceiptPdfFromCharge(charge: Stripe.Charge | null): Promise<Buffer | null> {
  const receiptUrl = charge?.receipt_url?.trim() ?? "";
  if (!receiptUrl) return null;
  const pdfUrl = stripeChargeReceiptPdfUrl(receiptUrl);
  if (!pdfUrl) return null;
  return fetchStripeReceiptPdfBuffer(pdfUrl);
}

/** Télécharge le PDF reçu Stripe du PaymentIntent Checkout (charge.receipt_url). */
export async function fetchStripeChargeReceiptPdfBufferFromPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<Buffer | null> {
  const piId = paymentIntentId.trim();
  if (!piId) return null;

  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(piId, {
        expand: ["latest_charge"],
      });
      const charge =
        paymentIntent.latest_charge && typeof paymentIntent.latest_charge === "object"
          ? paymentIntent.latest_charge
          : null;
      const pdf = await fetchReceiptPdfFromCharge(charge);
      if (pdf) return pdf;
      if (attempt < maxAttempts - 1) {
        await sleep(400 + attempt * 350);
        continue;
      }
      if (!charge?.receipt_url?.trim()) {
        console.error("[stripe-receipt-pdf] missing receipt_url", piId);
      }
    } catch (e) {
      console.error("[stripe-receipt-pdf] retrieve payment intent", piId, e);
      if (attempt < maxAttempts - 1) {
        await sleep(400 + attempt * 350);
        continue;
      }
    }
  }
  return null;
}

/** Télécharge le PDF reçu via la Checkout Session (fallback si PI absent des metadata facture). */
export async function fetchStripeChargeReceiptPdfBufferFromCheckoutSession(
  stripe: Stripe,
  checkoutSessionId: string,
): Promise<Buffer | null> {
  const sessionId = checkoutSessionId.trim();
  if (!sessionId) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.latest_charge"],
    });
    const pi = session.payment_intent;
    if (pi && typeof pi === "object") {
      const charge =
        pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      const pdf = await fetchReceiptPdfFromCharge(charge);
      if (pdf) return pdf;
      if (typeof pi.id === "string" && pi.id.trim()) {
        return fetchStripeChargeReceiptPdfBufferFromPaymentIntent(stripe, pi.id);
      }
    }
    if (typeof session.payment_intent === "string" && session.payment_intent.trim()) {
      return fetchStripeChargeReceiptPdfBufferFromPaymentIntent(stripe, session.payment_intent);
    }
  } catch (e) {
    console.error("[stripe-receipt-pdf] retrieve checkout session", sessionId, e);
  }
  return null;
}
