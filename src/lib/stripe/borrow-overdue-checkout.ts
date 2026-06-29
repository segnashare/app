import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { clearBorrowPaymentRecoveryIfSettled } from "@/lib/emprunt/borrow-payment-recovery";
import { BORROW_OVERDUE_STRIPE_MIN_EUR_CENTS } from "@/lib/stripe/borrow-overdue-penalty-charge";
import { getStripeConfig } from "@/lib/social/stripe";

export type BorrowOverdueUnpaidDay = {
  id: string;
  penalty_cents: number;
  calendar_date: string;
  late_day_index: number;
};

export async function fetchBorrowOverdueUnpaidDays(
  admin: SupabaseClient,
  cartId: string,
): Promise<BorrowOverdueUnpaidDay[]> {
  const { data: rows, error } = await admin
    .from("cart_borrow_overdue_days")
    .select("id, penalty_cents, calendar_date, late_day_index")
    .eq("cart_id", cartId)
    .in("charge_status", ["pending", "failed"])
    .is("stripe_payment_intent_id", null)
    .order("calendar_date", { ascending: true });

  if (error) throw new Error(error.message);

  return ((rows ?? []) as BorrowOverdueUnpaidDay[]).filter((r) => Math.trunc(Number(r.penalty_cents)) > 0);
}

export function sumBorrowOverdueUnpaidCents(days: BorrowOverdueUnpaidDay[]): number {
  return days.reduce((sum, d) => sum + Math.max(0, Math.trunc(Number(d.penalty_cents))), 0);
}

/** Marque les jours inclus sur la facture non-restitution (évite double encaissement). */
export async function markBorrowOverdueUnpaidDaysOnNonRestitutionInvoice(
  admin: SupabaseClient,
  dayIds: string[],
  stripeInvoiceId: string,
): Promise<void> {
  if (dayIds.length === 0) return;
  await admin
    .from("cart_borrow_overdue_days")
    .update({
      charge_status: "charged",
      stripe_payment_intent_id: stripeInvoiceId,
    })
    .in("id", dayIds)
    .in("charge_status", ["pending", "failed"]);
}

export function canCheckoutBorrowOverduePenalties(totalCents: number): boolean {
  return totalCents >= BORROW_OVERDUE_STRIPE_MIN_EUR_CENTS;
}

export async function ensureStripeCustomerForUser(
  admin: SupabaseClient,
  stripe: Stripe,
  userId: string,
  email?: string | null,
): Promise<string> {
  const { data: billingCustomerRow } = await admin
    .from("billing_customers")
    .select("provider_customer_id")
    .eq("provider", "stripe")
    .eq("user_id", userId)
    .maybeSingle();

  let stripeCustomerId = (billingCustomerRow as { provider_customer_id?: string } | null)?.provider_customer_id ?? null;
  if (stripeCustomerId) return stripeCustomerId;

  const createdCustomer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { user_id: userId },
  });
  stripeCustomerId = createdCustomer.id;
  await admin.from("billing_customers").upsert(
    {
      user_id: userId,
      provider: "stripe",
      provider_customer_id: stripeCustomerId,
      metadata: { source: "borrow_overdue_checkout" },
    },
    { onConflict: "user_id" },
  );
  return stripeCustomerId;
}

export async function createBorrowOverdueCheckoutSession(
  admin: SupabaseClient,
  input: { userId: string; cartId: string; userEmail?: string | null },
): Promise<{ url: string; amountCents: number }> {
  const unpaid = await fetchBorrowOverdueUnpaidDays(admin, input.cartId);
  const amountCents = sumBorrowOverdueUnpaidCents(unpaid);
  if (unpaid.length === 0) {
    throw new Error("nothing_to_settle");
  }
  if (!canCheckoutBorrowOverduePenalties(amountCents)) {
    throw new Error("amount_below_stripe_minimum");
  }

  const config = getStripeConfig();
  const stripe = new Stripe(config.secretKey);
  const stripeCustomerId = await ensureStripeCustomerForUser(admin, stripe, input.userId, input.userEmail);

  const lastDay = unpaid[unpaid.length - 1]!;
  const orderRef = input.cartId.slice(0, 8).toUpperCase();
  const successUrl = `${config.returnUrlBase}/api/stripe/borrow-overdue/sync?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.returnUrlBase}/exchange/emprunt/${input.cartId}/regulariser?checkout=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: {
        source: "borrow_overdue",
        cart_id: input.cartId,
        user_id: input.userId,
      },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: amountCents,
          product_data: {
            name: "Frais de retard — location Segna",
            description: `${unpaid.length} jour${unpaid.length > 1 ? "s" : ""} · commande ${orderRef}`,
          },
        },
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: input.userId,
    metadata: {
      checkout_kind: "borrow_overdue_penalty",
      user_id: input.userId,
      cart_id: input.cartId,
      amount_cents: String(amountCents),
      calendar_date: lastDay.calendar_date,
      late_day_index: String(lastDay.late_day_index),
      overdue_day_ids: unpaid.map((d) => d.id).join(",").slice(0, 500),
    },
  });

  if (!session.url) {
    throw new Error("stripe_checkout_url_missing");
  }

  return { url: session.url, amountCents };
}

export async function applyBorrowOverdueCheckoutSession(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<{ applied: boolean; paymentIntentId?: string }> {
  if (session.metadata?.checkout_kind !== "borrow_overdue_penalty") {
    return { applied: false };
  }
  if (session.payment_status !== "paid") {
    return { applied: false };
  }

  const cartId = String(session.metadata?.cart_id ?? "").trim();
  const amountCentsMeta = Math.trunc(Number(session.metadata?.amount_cents ?? 0));
  const overdueDayIds = String(session.metadata?.overdue_day_ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!cartId || overdueDayIds.length === 0 || amountCentsMeta <= 0) {
    return { applied: false };
  }

  const unpaid = await fetchBorrowOverdueUnpaidDays(admin, cartId);
  const expectedIds = unpaid.map((d) => d.id).sort();
  const metaIds = [...overdueDayIds].sort();
  const expectedTotal = sumBorrowOverdueUnpaidCents(unpaid);

  if (
    expectedTotal !== amountCentsMeta ||
    expectedIds.length !== metaIds.length ||
    expectedIds.some((id, i) => id !== metaIds[i])
  ) {
    throw new Error("checkout_metadata_mismatch");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent && typeof session.payment_intent === "object"
        ? session.payment_intent.id
        : null;

  if (!paymentIntentId) {
    throw new Error("missing_payment_intent");
  }

  await admin
    .from("cart_borrow_overdue_days")
    .update({
      charge_status: "charged",
      stripe_payment_intent_id: paymentIntentId,
    })
    .in("id", overdueDayIds);

  await clearBorrowPaymentRecoveryIfSettled(admin, cartId);

  return { applied: true, paymentIntentId };
}
