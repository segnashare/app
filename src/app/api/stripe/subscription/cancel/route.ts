import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { applySubscriptionCancelAtPeriodEndEffects } from "@/lib/subscription/apply-cancel-at-period-end-effects";
import {
  isSubscriptionCancelReasonCode,
  labelForCancelReason,
} from "@/lib/subscription/cancel-reasons";
import { upsertSubscriptionAndEntitlements } from "@/lib/stripe/subscription-state";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

type CancelBody = {
  reasonCode?: unknown;
  source?: unknown;
};

/**
 * Annulation membre en fin de période + questionnaire.
 * Body: `{ reasonCode: string }`
 * Auth : cookies app ou `Authorization: Bearer` (mobile).
 */
export async function POST(request: Request) {
  const { user, error: userError } = await resolveRequestUser(request);

  if (userError || !user) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: CancelBody;
  try {
    body = (await request.json()) as CancelBody;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode.trim() : "";
  if (!isSubscriptionCancelReasonCode(reasonCode)) {
    return NextResponse.json({ ok: false as const, error: "reason_required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient() as any;

  const { data: subRow, error: subErr } = await admin
    .from("user_subscriptions")
    .select(
      "provider_subscription_id, provider_customer_id, plan_code, status, cancel_at_period_end, current_period_end",
    )
    .eq("user_id", user.id)
    .eq("provider", "stripe")
    .maybeSingle();

  if (subErr) {
    return NextResponse.json({ ok: false as const, error: "subscription_read_failed" }, { status: 500 });
  }

  const subscriptionId =
    typeof subRow?.provider_subscription_id === "string" ? subRow.provider_subscription_id.trim() : "";
  if (!subscriptionId) {
    return NextResponse.json({ ok: false as const, error: "subscription_not_found" }, { status: 404 });
  }

  const status = String(subRow?.status ?? "").toLowerCase();
  if (status === "canceled" || status === "incomplete_expired") {
    return NextResponse.json({ ok: false as const, error: "already_canceled" }, { status: 409 });
  }

  const { secretKey } = getStripeConfig();
  const stripe = new Stripe(secretKey);

  let subscription: Stripe.Subscription;
  try {
    if (Boolean(subRow?.cancel_at_period_end)) {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } else {
      subscription = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "stripe_cancel_failed";
    console.error("[subscription/cancel] stripe", msg);
    return NextResponse.json(
      { ok: false as const, error: "stripe_cancel_failed", detail: msg },
      { status: 502 },
    );
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : typeof subRow?.provider_customer_id === "string"
        ? subRow.provider_customer_id
        : null;

  await upsertSubscriptionAndEntitlements(admin, user.id, customerId, subscription);

  const { periodEndIso, updatedCartIds } = await applySubscriptionCancelAtPeriodEndEffects(
    admin,
    user.id,
    subscription,
    { notify: true },
  );

  const { error: feedbackErr } = await admin.from("subscription_cancel_feedback").insert({
    user_id: user.id,
    provider: "stripe",
    provider_subscription_id: subscriptionId,
    plan_code: subRow?.plan_code ?? null,
    reason_code: reasonCode,
    reason_label: labelForCancelReason(reasonCode),
    cancel_mode: "at_period_end",
    period_end_at: periodEndIso,
    source: "member_app",
    metadata: { updated_cart_ids: updatedCartIds },
  });
  if (feedbackErr) {
    console.error("[subscription/cancel] feedback insert", feedbackErr.message);
  }

  return NextResponse.json({
    ok: true as const,
    cancel_at_period_end: true,
    period_end: periodEndIso,
    updated_cart_ids: updatedCartIds,
  });
}
