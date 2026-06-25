import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyBorrowOverdueDaily } from "@/lib/notifications/lifecycle-shipment-notify";

type SettledDayRow = {
  id: string;
  late_day_index: number;
  calendar_date: string;
  penalty_cents: number;
  penalty_credits: number;
  rate_bps: number;
  stripe_payment_intent_id: string | null;
  notified_at: string | null;
};

function borrowOverdueStripeNotifyKey(paymentIntentId: string): string {
  return `txn:lc:borrow_overdue_stripe:${paymentIntentId}`;
}

async function markBorrowOverdueDaysNotified(
  admin: SupabaseClient,
  dayIds: string[],
): Promise<void> {
  if (dayIds.length === 0) return;
  await admin
    .from("cart_borrow_overdue_days")
    .update({ notified_at: new Date().toISOString() })
    .in("id", dayIds);
}

/**
 * E-mail + SMS après PaymentIntent Stripe réussi (`cart_borrow_overdue_days.charge_status = charged`).
 * Idempotent via `notification_send_log` + `notified_at` sur les lignes journalisées.
 */
export async function notifyBorrowOverdueAfterStripeCharge(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    paymentIntentId: string;
    cronSmsNowMs?: number;
  },
): Promise<boolean> {
  const { data: dayRows, error } = await admin
    .from("cart_borrow_overdue_days")
    .select(
      "id, late_day_index, calendar_date, penalty_cents, penalty_credits, rate_bps, stripe_payment_intent_id, notified_at",
    )
    .eq("cart_id", input.cartId)
    .eq("stripe_payment_intent_id", input.paymentIntentId)
    .eq("charge_status", "charged");

  if (error || !Array.isArray(dayRows) || dayRows.length === 0) {
    return false;
  }

  const days = dayRows as SettledDayRow[];
  const idempotencyKey = borrowOverdueStripeNotifyKey(input.paymentIntentId);

  const { data: existingLog } = await admin
    .from("notification_send_log")
    .select("delivery_channels")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (
    existingLog &&
    String((existingLog as { delivery_channels?: string }).delivery_channels ?? "none") !== "none"
  ) {
    await markBorrowOverdueDaysNotified(
      admin,
      days.map((d) => d.id),
    );
    return true;
  }

  const sorted = [...days].sort((a, b) => a.calendar_date.localeCompare(b.calendar_date));
  const anchor = sorted[sorted.length - 1]!;
  const totalPenaltyCents = days.reduce(
    (sum, d) => sum + Math.max(0, Math.trunc(Number(d.penalty_cents))),
    0,
  );
  const totalPenaltyCredits = days.reduce(
    (sum, d) => sum + Math.max(0, Math.trunc(Number(d.penalty_credits))),
    0,
  );

  await notifyBorrowOverdueDaily(admin, {
    userId: input.userId,
    cartId: input.cartId,
    lateDayIndex: anchor.late_day_index,
    penaltyCents: totalPenaltyCents,
    penaltyCredits: totalPenaltyCredits,
    rateBps: anchor.rate_bps,
    chargeStatus: "charged",
    calendarDate: anchor.calendar_date,
    chargedViaStripe: true,
    cronSmsNowMs: input.cronSmsNowMs,
    idempotencyKey,
  });

  const { data: sentLog } = await admin
    .from("notification_send_log")
    .select("delivery_channels")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  const outreachSent =
    sentLog != null &&
    String((sentLog as { delivery_channels?: string }).delivery_channels ?? "none") !== "none";

  if (outreachSent) {
    await markBorrowOverdueDaysNotified(
      admin,
      days.map((d) => d.id),
    );
    return true;
  }

  return false;
}

/** Rattrapage : prélèvements Stripe déjà `charged` sans outreach (ex. sync page avant fix). */
export async function notifyUnsentBorrowOverdueStripeCharges(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    cronSmsNowMs?: number;
  },
): Promise<boolean> {
  const { data: rows, error } = await admin
    .from("cart_borrow_overdue_days")
    .select("stripe_payment_intent_id")
    .eq("cart_id", input.cartId)
    .eq("charge_status", "charged")
    .not("stripe_payment_intent_id", "is", null)
    .is("notified_at", null);

  if (error || !Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  const paymentIntentIds = [
    ...new Set(
      (rows as { stripe_payment_intent_id?: string | null }[])
        .map((r) => r.stripe_payment_intent_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  let notified = false;
  for (const paymentIntentId of paymentIntentIds) {
    if (
      await notifyBorrowOverdueAfterStripeCharge(admin, {
        userId: input.userId,
        cartId: input.cartId,
        paymentIntentId,
        cronSmsNowMs: input.cronSmsNowMs,
      })
    ) {
      notified = true;
    }
  }

  return notified;
}
