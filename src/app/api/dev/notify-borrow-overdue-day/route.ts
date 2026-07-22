import { NextResponse } from "next/server";

import { notifyBorrowOverdueDailyWhenUnsettled } from "@/lib/cart/notify-borrow-overdue-daily-unsettled";
import {
  borrowOverdueStripeNotifyKey,
  notifyBorrowOverdueAfterStripeCharge,
  notifyUnsentBorrowOverdueStripeCharges,
  resetBorrowOverdueOutreachForCart,
} from "@/lib/cart/notify-borrow-overdue-after-stripe-charge";
import { settleCartBorrowOverdueStripe } from "@/lib/cart/settle-borrow-overdue-stripe";
import type { BorrowOverdueAccrueResult } from "@/lib/emprunt/borrow-overdue-penalty";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maybeNotifyBorrowOverdueAccrueN8n } from "@/lib/disputes/notify-borrow-overdue-escalation-dispute-n8n";

type Body = {
  cart_id?: string;
  calendar_date?: string;
  /** Crée la ligne via RPC si absente (comme dev-accrue). */
  accrue_if_missing?: boolean;
  /** Efface idempotence outreach (jour + Stripe PI) et `notified_at` avant envoi. */
  force?: boolean;
};

function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Dev uniquement : mail + SMS `borrow_overdue_daily` pour un `calendar_date` donné
 * (ex. J3 du 26 alors qu'on est encore le 25).
 *
 * POST /api/dev/notify-borrow-overdue-day
 * Body: { cart_id, calendar_date, accrue_if_missing?, force? }
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ ok: false, error: "dev_only" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const cartId = String(body.cart_id ?? "").trim();
  const calendarDate = String(body.calendar_date ?? "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(cartId)) {
    return NextResponse.json({ ok: false, error: "invalid_cart_id" }, { status: 400 });
  }
  if (!isCalendarDate(calendarDate)) {
    return NextResponse.json(
      { ok: false, error: "invalid_calendar_date", hint: "YYYY-MM-DD (jour Paris)" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: cart, error: cartErr } = await admin
    .from("carts")
    .select("id,user_id")
    .eq("id", cartId)
    .maybeSingle();

  if (cartErr || !cart?.user_id) {
    return NextResponse.json({ ok: false, error: "cart_not_found" }, { status: 404 });
  }

  const userId = String(cart.user_id);
  const devNotifyOpts = { skipCronSmsDailyCap: true as const };

  let resetResult: { clearedLogs: number; resetDays: number } | null = null;
  if (body.force === true) {
    resetResult = await resetBorrowOverdueOutreachForCart(admin, cartId, { calendarDate });
  }

  let accrueResult: BorrowOverdueAccrueResult | null = null;
  const accrueIfMissing = body.accrue_if_missing === true || body.force === true;

  if (accrueIfMissing) {
    const { data, error } = await admin.rpc("accrue_cart_borrow_overdue_day", {
      p_cart_id: cartId,
      p_calendar_date: calendarDate,
      p_force_notify: false,
    });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    accrueResult = data as BorrowOverdueAccrueResult;
    try {
      await maybeNotifyBorrowOverdueAccrueN8n(admin, cartId, calendarDate, accrueResult);
    } catch (e) {
      console.error("[dev/notify-borrow-overdue-day] n8n", cartId, e);
    }
  }

  const { data: dayRow, error: dayErr } = await admin
    .from("cart_borrow_overdue_days")
    .select(
      "id,late_day_index,calendar_date,penalty_cents,penalty_credits,rate_bps,charge_status,stripe_payment_intent_id",
    )
    .eq("cart_id", cartId)
    .eq("calendar_date", calendarDate)
    .maybeSingle();

  if (dayErr || !dayRow) {
    return NextResponse.json(
      {
        ok: false,
        error: "day_not_found",
        hint: "Jour absent : relance avec --force (accuse auto) ou --accrue.",
        accrue: accrueResult,
        reset: resetResult,
      },
      { status: 404 },
    );
  }

  const stripe = await settleCartBorrowOverdueStripe(admin, {
    userId,
    cartId,
    cronSmsNowMs: Date.now(),
    ...devNotifyOpts,
  });

  let channel: "stripe_charge" | "unsettled" | "stripe_backfill" | "none" = "none";

  if (stripe.charged && stripe.paymentIntentId) {
    if (
      await notifyBorrowOverdueAfterStripeCharge(admin, {
        userId,
        cartId,
        paymentIntentId: stripe.paymentIntentId,
        cronSmsNowMs: Date.now(),
        ...devNotifyOpts,
      })
    ) {
      channel = "stripe_charge";
    }
  } else if (String(dayRow.charge_status) === "charged" && dayRow.stripe_payment_intent_id) {
    const pi = String(dayRow.stripe_payment_intent_id);
    if (
      await notifyBorrowOverdueAfterStripeCharge(admin, {
        userId,
        cartId,
        paymentIntentId: pi,
        cronSmsNowMs: Date.now(),
        ...devNotifyOpts,
      })
    ) {
      channel = "stripe_backfill";
    }
  } else if (
    await notifyUnsentBorrowOverdueStripeCharges(admin, {
      userId,
      cartId,
      cronSmsNowMs: Date.now(),
      ...devNotifyOpts,
    })
  ) {
    channel = "stripe_backfill";
  } else if (String(dayRow.charge_status) !== "charged") {
    const accrue: BorrowOverdueAccrueResult = {
      ok: true,
      applied: true,
      late_day: Number(dayRow.late_day_index),
      penalty_cents: Number(dayRow.penalty_cents),
      penalty_credits: Number(dayRow.penalty_credits),
      rate_bps: Number(dayRow.rate_bps),
      charge_status: String(dayRow.charge_status),
    };
    if (
      await notifyBorrowOverdueDailyWhenUnsettled(admin, {
        userId,
        cartId,
        calendarDate,
        accrue,
        settleError: stripe.error,
        cronSmsNowMs: Date.now(),
        ...devNotifyOpts,
      })
    ) {
      channel = "unsettled";
    }
  }

  const calendarLogKey = `txn:lc:borrow_overdue:${cartId}:${calendarDate}`;
  const stripeLogKey = dayRow.stripe_payment_intent_id
    ? borrowOverdueStripeNotifyKey(String(dayRow.stripe_payment_intent_id))
    : stripe.paymentIntentId
      ? borrowOverdueStripeNotifyKey(stripe.paymentIntentId)
      : null;

  const logKeys = [calendarLogKey, ...(stripeLogKey ? [stripeLogKey] : [])];
  const { data: logRows } = await admin
    .from("notification_send_log")
    .select("idempotency_key,delivery_channels,kind,created_at")
    .in("idempotency_key", logKeys);

  const primaryLog =
    (logRows ?? []).find((r) => r.idempotency_key === stripeLogKey) ??
    (logRows ?? []).find((r) => r.idempotency_key === calendarLogKey) ??
    null;

  return NextResponse.json({
    ok: true,
    cart_id: cartId,
    calendar_date: calendarDate,
    late_day_index: dayRow.late_day_index,
    charge_status: dayRow.charge_status,
    notify_channel: channel,
    stripe: {
      charged: stripe.charged,
      error: stripe.error ?? null,
      payment_intent_id: stripe.paymentIntentId ?? dayRow.stripe_payment_intent_id ?? null,
    },
    accrue: accrueResult,
    reset: resetResult,
    outreach_logs: logRows ?? [],
    delivery_channels: (primaryLog as { delivery_channels?: string } | null)?.delivery_channels ?? null,
    note:
      channel === "none"
        ? "Aucun envoi (Resend/Twilio off, ou outreach déjà complet)."
        : "Dev : plafond SMS désactivé. Vérifie mail + SMS.",
  });
}
