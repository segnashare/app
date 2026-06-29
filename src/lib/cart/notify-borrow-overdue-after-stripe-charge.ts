import type { SupabaseClient } from "@supabase/supabase-js";

import { borrowOverdueDailyEmail } from "@/lib/notifications/lifecycle-shipment-email";
import { NotificationKind } from "@/lib/notifications/kinds";
import { notifyBorrowOverdueDaily } from "@/lib/notifications/lifecycle-shipment-notify";
import { loadUserContact } from "@/lib/notifications/member-outreach-contact";
import {
  isMemberOutreachFullyDelivered,
  isMemberOutreachSmsRequested,
  tryUpgradeMemberOutreachSms,
} from "@/lib/notifications/member-outreach-sms-upgrade";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";

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

function buildStripeChargeNotifyPayload(
  input: { userId: string; cartId: string },
  days: SettledDayRow[],
  paymentIntentId: string,
) {
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
  const idempotencyKey = borrowOverdueStripeNotifyKey(paymentIntentId);
  const cartLabel = `Commande ${input.cartId.slice(0, 8).toUpperCase()}`;
  const ratePercent = Math.round(anchor.rate_bps / 100);
  const { subject, text, html, smsBody } = borrowOverdueDailyEmail(null, {
    cartLabel,
    lateDayIndex: anchor.late_day_index,
    penaltyCents: totalPenaltyCents,
    penaltyCredits: totalPenaltyCredits,
    ratePercent,
    chargeStatus: "charged",
    chargedViaStripe: true,
  });

  return {
    idempotencyKey,
    anchor,
    totalPenaltyCents,
    totalPenaltyCredits,
    subject,
    text,
    html,
    smsBody,
    metadata: {
      cart_id: input.cartId,
      late_day_index: anchor.late_day_index,
      penalty_cents: totalPenaltyCents,
      charge_status: "charged",
      calendar_date: anchor.calendar_date,
    },
  };
}

async function resolveSmsDeliverable(admin: SupabaseClient, userId: string): Promise<boolean> {
  const user = await loadUserContact(admin, userId);
  return Boolean(tryNormalizePhoneToE164(user?.phone ?? null));
}

async function readOutreachDeliveryChannels(
  admin: SupabaseClient,
  idempotencyKey: string,
): Promise<string> {
  const { data } = await admin
    .from("notification_send_log")
    .select("delivery_channels")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return String((data as { delivery_channels?: string } | null)?.delivery_channels ?? "none");
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
    skipCronSmsDailyCap?: boolean;
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
  const payload = buildStripeChargeNotifyPayload(input, days, input.paymentIntentId);
  const smsRequested = isMemberOutreachSmsRequested({
    channels: "email+phone",
    smsBody: payload.smsBody,
  });
  const smsDeliverable = smsRequested ? await resolveSmsDeliverable(admin, input.userId) : false;
  const dayIds = days.map((d) => d.id);

  const existingChannels = await readOutreachDeliveryChannels(admin, payload.idempotencyKey);

  if (isMemberOutreachFullyDelivered(existingChannels, smsRequested, smsDeliverable)) {
    await markBorrowOverdueDaysNotified(admin, dayIds);
    return true;
  }

  if (existingChannels === "email" && smsRequested && payload.smsBody?.trim()) {
    const upgraded = await tryUpgradeMemberOutreachSms(admin, {
      idempotencyKey: payload.idempotencyKey,
      userId: input.userId,
      kind: NotificationKind.borrowOverdueDaily,
      smsBody: payload.smsBody,
      metadata: payload.metadata,
      applyCronSmsDailyCap: true,
      skipCronSmsDailyCap: input.skipCronSmsDailyCap,
      cronSmsNowMs: input.cronSmsNowMs,
    });
    const channels = await readOutreachDeliveryChannels(admin, payload.idempotencyKey);
    if (isMemberOutreachFullyDelivered(channels, smsRequested, smsDeliverable)) {
      await markBorrowOverdueDaysNotified(admin, dayIds);
    }
    return upgraded || channels === "email";
  }

  if (existingChannels !== "none") {
    return existingChannels === "email";
  }

  await notifyBorrowOverdueDaily(admin, {
    userId: input.userId,
    cartId: input.cartId,
    lateDayIndex: payload.anchor.late_day_index,
    penaltyCents: payload.totalPenaltyCents,
    penaltyCredits: payload.totalPenaltyCredits,
    rateBps: payload.anchor.rate_bps,
    chargeStatus: "charged",
    calendarDate: payload.anchor.calendar_date,
    chargedViaStripe: true,
    cronSmsNowMs: input.cronSmsNowMs,
    skipCronSmsDailyCap: input.skipCronSmsDailyCap,
    idempotencyKey: payload.idempotencyKey,
  });

  const channels = await readOutreachDeliveryChannels(admin, payload.idempotencyKey);
  if (isMemberOutreachFullyDelivered(channels, smsRequested, smsDeliverable)) {
    await markBorrowOverdueDaysNotified(admin, dayIds);
    return true;
  }

  return channels !== "none";
}

/** Rattrapage : prélèvements Stripe déjà `charged` sans outreach complet. */
export async function notifyUnsentBorrowOverdueStripeCharges(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    cronSmsNowMs?: number;
    skipCronSmsDailyCap?: boolean;
  },
): Promise<boolean> {
  const { data: rows, error } = await admin
    .from("cart_borrow_overdue_days")
    .select("id, stripe_payment_intent_id, notified_at")
    .eq("cart_id", input.cartId)
    .eq("charge_status", "charged")
    .not("stripe_payment_intent_id", "is", null);

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
        skipCronSmsDailyCap: input.skipCronSmsDailyCap,
      })
    ) {
      notified = true;
    }
  }

  return notified;
}

/** Dev : efface idempotence outreach + `notified_at` pour re-tester mail/SMS. */
export async function resetBorrowOverdueOutreachForCart(
  admin: SupabaseClient,
  cartId: string,
  opts?: { calendarDate?: string },
): Promise<{ clearedLogs: number; resetDays: number }> {
  let dayQuery = admin
    .from("cart_borrow_overdue_days")
    .select("id, calendar_date, stripe_payment_intent_id")
    .eq("cart_id", cartId);

  if (opts?.calendarDate) {
    dayQuery = dayQuery.eq("calendar_date", opts.calendarDate);
  }

  const { data: dayRows } = await dayQuery;
  const days = (dayRows ?? []) as {
    id: string;
    calendar_date: string;
    stripe_payment_intent_id: string | null;
  }[];

  const keys = new Set<string>();
  for (const day of days) {
    keys.add(`txn:lc:borrow_overdue:${cartId}:${day.calendar_date}`);
    const pi = day.stripe_payment_intent_id?.trim();
    if (pi) keys.add(`txn:lc:borrow_overdue_stripe:${pi}`);
  }

  let clearedLogs = keys.size;
  for (const key of keys) {
    await admin.from("notification_send_log").delete().eq("idempotency_key", key);
  }

  const dayIds = days.map((d) => d.id);
  if (dayIds.length > 0) {
    await admin.from("cart_borrow_overdue_days").update({ notified_at: null }).in("id", dayIds);
  }

  return { clearedLogs, resetDays: dayIds.length };
}

export { borrowOverdueStripeNotifyKey };
