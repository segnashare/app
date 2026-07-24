import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { upsertSubscriptionAndEntitlements } from "@/lib/stripe/subscription-state";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function internalBackofficeSecrets(): string[] {
  const dedicated = process.env.SEGNA_INTERNAL_BACKOFFICE_CART_CANCEL_SECRET?.trim() ?? "";
  const ship = process.env.SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET?.trim() ?? "";
  const uber = process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ?? "";
  return [...new Set([dedicated, ship, uber].filter(Boolean))];
}

/**
 * Annulation d’abonnement depuis le back-office.
 *
 * Auth : mêmes secrets que `backoffice-cancel-cart-order-pending`.
 * Body : `{ user_id, mode?: "at_period_end" | "immediate", actor_user_id? }`
 */
export async function POST(request: Request) {
  const candidates = internalBackofficeSecrets();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { user_id?: unknown; mode?: unknown; actor_user_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!isUuid(userId)) {
    return NextResponse.json({ ok: false as const, error: "user_id_invalid" }, { status: 400 });
  }

  const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "at_period_end";
  const mode = modeRaw === "immediate" ? "immediate" : "at_period_end";

  const admin = createSupabaseAdminClient() as any;

  const { data: subRow, error: subErr } = await admin
    .from("user_subscriptions")
    .select("provider_subscription_id, provider_customer_id, plan_code, status, cancel_at_period_end")
    .eq("user_id", userId)
    .eq("provider", "stripe")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subErr) {
    return NextResponse.json({ ok: false as const, error: "subscription_read_failed", detail: subErr.message }, { status: 500 });
  }

  const subscriptionId =
    typeof subRow?.provider_subscription_id === "string" ? subRow.provider_subscription_id.trim() : "";
  if (!subscriptionId) {
    return NextResponse.json({ ok: false as const, error: "subscription_not_found" }, { status: 404 });
  }

  const status = String(subRow?.status ?? "").toLowerCase();
  if (status === "canceled" || status === "incomplete_expired") {
    return NextResponse.json({ ok: true as const, skipped: true as const, reason: "already_canceled" });
  }

  if (mode === "at_period_end" && Boolean(subRow?.cancel_at_period_end)) {
    return NextResponse.json({ ok: true as const, skipped: true as const, reason: "already_cancel_at_period_end" });
  }

  try {
    const { secretKey } = getStripeConfig();
    const stripe = new Stripe(secretKey);

    const subscription =
      mode === "immediate"
        ? await stripe.subscriptions.cancel(subscriptionId, { prorate: false })
        : await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });

    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : typeof subRow?.provider_customer_id === "string"
          ? subRow.provider_customer_id
          : null;

    await upsertSubscriptionAndEntitlements(admin, userId, customerId, subscription);

    return NextResponse.json({
      ok: true as const,
      mode,
      status: subscription.status,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      plan_code: subRow?.plan_code ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe_cancel_failed";
    console.error("[internal/backoffice-cancel-subscription]", message);
    return NextResponse.json({ ok: false as const, error: "stripe_cancel_failed", detail: message }, { status: 502 });
  }
}
