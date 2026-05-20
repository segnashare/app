import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";

/** Minimum Stripe pour un PaymentIntent en EUR. */
export const BORROW_OVERDUE_STRIPE_MIN_EUR_CENTS = 50;

type ChargeInput = {
  userId: string;
  cartId: string;
  overdueDayIds: string[];
  penaltyCents: number;
  calendarDate: string;
  lateDayIndex: number;
};

type OverdueDayRow = {
  id: string;
  penalty_cents: number;
  calendar_date: string;
  late_day_index: number;
  charge_status: string;
  stripe_payment_intent_id: string | null;
};

function stripeChargeEnabled(): boolean {
  return process.env.SEGNA_BORROW_OVERDUE_STRIPE_CHARGE !== "0";
}

async function resolveStripeCustomerPaymentMethod(
  stripe: Stripe,
  admin: SupabaseClient,
  userId: string,
): Promise<
  | { ok: true; customerId: string; paymentMethodId: string }
  | { ok: false; error: string }
> {
  const { data: billingRow } = await admin
    .from("billing_customers")
    .select("provider_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  const customerId =
    typeof (billingRow as { provider_customer_id?: string } | null)?.provider_customer_id === "string"
      ? (billingRow as { provider_customer_id: string }).provider_customer_id.trim()
      : "";
  if (!customerId) {
    return { ok: false, error: "no_billing_customer" };
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    return { ok: false, error: "customer_deleted" };
  }

  const defaultPm = customer.invoice_settings?.default_payment_method;
  let paymentMethodId =
    typeof defaultPm === "string" ? defaultPm : defaultPm && typeof defaultPm === "object" ? defaultPm.id : null;

  if (!paymentMethodId) {
    const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    paymentMethodId = pms.data[0]?.id ?? null;
  }

  if (!paymentMethodId) {
    return { ok: false, error: "no_payment_method" };
  }

  return { ok: true, customerId, paymentMethodId };
}

async function markOverdueDaysChargeFailed(
  admin: SupabaseClient,
  dayIds: string[],
): Promise<void> {
  if (dayIds.length === 0) return;
  await admin
    .from("cart_borrow_overdue_days")
    .update({ charge_status: "failed" })
    .in("id", dayIds)
    .in("charge_status", ["pending", "failed"]);
}

async function markOverdueDaysCharged(
  admin: SupabaseClient,
  dayIds: string[],
  paymentIntentId: string,
): Promise<void> {
  if (dayIds.length === 0) return;
  await admin
    .from("cart_borrow_overdue_days")
    .update({
      charge_status: "charged",
      stripe_payment_intent_id: paymentIntentId,
    })
    .in("id", dayIds);
}

/**
 * Prélèvement carte (off-session) en EUR pour une ou plusieurs journées de pénalité.
 */
async function chargeBorrowOverdueViaStripe(
  admin: SupabaseClient,
  input: ChargeInput,
): Promise<{ charged: boolean; paymentIntentId?: string; error?: string }> {
  const cents = Math.max(0, Math.trunc(input.penaltyCents));
  if (cents < BORROW_OVERDUE_STRIPE_MIN_EUR_CENTS) {
    return { charged: false, error: "amount_below_stripe_minimum" };
  }

  if (!stripeChargeEnabled()) {
    return { charged: false, error: "stripe_charge_disabled" };
  }

  let stripe: Stripe;
  try {
    stripe = new Stripe(getStripeConfig().secretKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { charged: false, error: msg };
  }

  const pm = await resolveStripeCustomerPaymentMethod(stripe, admin, input.userId);
  if (!pm.ok) {
    await markOverdueDaysChargeFailed(admin, input.overdueDayIds);
    return { charged: false, error: pm.error };
  }

  const idempotencyKey = `borrow_overdue_stripe:${input.cartId}:${input.calendarDate}:${cents}`;

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "eur",
        customer: pm.customerId,
        payment_method: pm.paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Segna — pénalité retard retour (jour ${input.lateDayIndex})`,
        metadata: {
          source: "borrow_overdue",
          cart_id: input.cartId,
          user_id: input.userId,
          calendar_date: input.calendarDate,
          late_day_index: String(input.lateDayIndex),
          overdue_day_ids: input.overdueDayIds.join(",").slice(0, 500),
        },
      },
      { idempotencyKey },
    );

    if (pi.status !== "succeeded") {
      await markOverdueDaysChargeFailed(admin, input.overdueDayIds);
      return { charged: false, error: `payment_intent_${pi.status}` };
    }

    await markOverdueDaysCharged(admin, input.overdueDayIds, pi.id);
    return { charged: true, paymentIntentId: pi.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markOverdueDaysChargeFailed(admin, input.overdueDayIds);
    return { charged: false, error: msg };
  }
}

/** @deprecated Préférer `settleBorrowOverdueStripeCharges`. */
export async function tryStripeChargeBorrowOverduePenalty(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    overdueDayId: string;
    penaltyCents: number;
    calendarDate: string;
    lateDayIndex: number;
  },
): Promise<{ charged: boolean; paymentIntentId?: string; error?: string }> {
  return chargeBorrowOverdueViaStripe(admin, {
    userId: input.userId,
    cartId: input.cartId,
    overdueDayIds: [input.overdueDayId],
    penaltyCents: input.penaltyCents,
    calendarDate: input.calendarDate,
    lateDayIndex: input.lateDayIndex,
  });
}

/**
 * Règle les jours `pending` / `failed` sans PaymentIntent : cumul jusqu’au minimum Stripe (0,50 €).
 */
export async function settleBorrowOverdueStripeCharges(
  admin: SupabaseClient,
  input: { userId: string; cartId: string },
): Promise<{ charged: boolean; paymentIntentId?: string; error?: string; totalCents?: number }> {
  const { data: rows, error } = await admin
    .from("cart_borrow_overdue_days")
    .select("id, penalty_cents, calendar_date, late_day_index, charge_status, stripe_payment_intent_id")
    .eq("cart_id", input.cartId)
    .in("charge_status", ["pending", "failed"])
    .is("stripe_payment_intent_id", null)
    .order("calendar_date", { ascending: true });

  if (error) {
    return { charged: false, error: error.message };
  }

  const unpaid = ((rows ?? []) as OverdueDayRow[]).filter((r) => Number(r.penalty_cents) > 0);
  if (unpaid.length === 0) {
    return { charged: false, error: "nothing_to_settle" };
  }

  const totalCents = unpaid.reduce((sum, r) => sum + Math.max(0, Math.trunc(Number(r.penalty_cents))), 0);
  if (totalCents < BORROW_OVERDUE_STRIPE_MIN_EUR_CENTS) {
    return { charged: false, error: "amount_below_stripe_minimum", totalCents };
  }

  const lastDay = unpaid[unpaid.length - 1]!;
  return chargeBorrowOverdueViaStripe(admin, {
    userId: input.userId,
    cartId: input.cartId,
    overdueDayIds: unpaid.map((r) => r.id),
    penaltyCents: totalCents,
    calendarDate: lastDay.calendar_date,
    lateDayIndex: lastDay.late_day_index,
  });
}
