import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PlanCode = "guest" | "segna_plus" | "segna_x";

function isPlanCode(value: string | null | undefined): value is PlanCode {
  return value === "guest" || value === "segna_plus" || value === "segna_x";
}

function unixToIso(value: number | null | undefined): string | null {
  if (!value || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

async function getMappedPlanCodeFromSubscription(admin: any, subscription: Stripe.Subscription): Promise<PlanCode> {
  const stripePriceId = subscription.items.data[0]?.price?.id ?? null;

  if (stripePriceId) {
    const { data: mappedRow } = await admin
      .from("billing_plan_prices")
      .select("plan_code")
      .eq("stripe_price_id", stripePriceId)
      .maybeSingle();

    if (isPlanCode(mappedRow?.plan_code)) {
      return mappedRow.plan_code;
    }
  }

  const metadataPlan = subscription.metadata?.plan_code;
  if (isPlanCode(metadataPlan)) return metadataPlan;
  return "guest";
}

async function upsertBillingCustomer(admin: any, userId: string, stripeCustomerId: string, metadata?: Record<string, unknown>) {
  await admin.from("billing_customers").upsert(
    {
      user_id: userId,
      provider: "stripe",
      provider_customer_id: stripeCustomerId,
      metadata: metadata ?? {},
    },
    { onConflict: "user_id" },
  );
}

async function upsertSubscriptionAndEntitlements(
  admin: any,
  userId: string,
  stripeCustomerId: string | null,
  subscription: Stripe.Subscription,
) {
  const planCode = await getMappedPlanCodeFromSubscription(admin, subscription);
  const entitlementPlan: PlanCode = subscription.status === "active" || subscription.status === "trialing" ? planCode : "guest";

  // Basil API: current_period_start/end moved from Subscription to SubscriptionItem
  const firstItem = subscription.items.data[0];
  const currentPeriodStart = firstItem?.current_period_start ?? null;
  const currentPeriodEnd = firstItem?.current_period_end ?? null;

  await admin.from("user_subscriptions").upsert(
    {
      user_id: userId,
      provider: "stripe",
      provider_customer_id: stripeCustomerId,
      provider_subscription_id: subscription.id,
      plan_code: planCode,
      status: subscription.status,
      current_period_start: unixToIso(currentPeriodStart),
      current_period_end: unixToIso(currentPeriodEnd),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      canceled_at: unixToIso(subscription.canceled_at),
      trial_start: unixToIso(subscription.trial_start),
      trial_end: unixToIso(subscription.trial_end),
      metadata: subscription.metadata ?? {},
      raw_payload: subscription as unknown as Record<string, unknown>,
    },
    { onConflict: "user_id,provider" },
  );

  await admin.rpc("billing_upsert_monthly_entitlement", {
    p_user_id: userId,
    p_plan_code: entitlementPlan,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  const fallbackPlan = url.searchParams.get("plan") ?? "segna_plus";

  if (!sessionId) {
    return NextResponse.redirect(new URL("/exchange?subscription=error&reason=missing_session", url.origin));
  }

  try {
    const supabase = (await createSupabaseServerClient()) as any;
    const admin = createSupabaseAdminClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.redirect(new URL("/auth/sign-in", url.origin));
    }

    const { secretKey } = getStripeConfig();
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

    const expectedUserId = session.metadata?.user_id ?? (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
    if (expectedUserId && expectedUserId !== user.id) {
      return NextResponse.redirect(new URL("/exchange?subscription=error&reason=user_mismatch", url.origin));
    }

    const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
    if (!stripeCustomerId) {
      return NextResponse.redirect(new URL("/exchange?subscription=error&reason=missing_customer", url.origin));
    }

    await upsertBillingCustomer(admin, user.id, stripeCustomerId, session.metadata ?? {});

    const subscription =
      typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : (session.subscription as Stripe.Subscription | null);

    if (!subscription?.id) {
      return NextResponse.redirect(new URL("/exchange?subscription=error&reason=missing_subscription", url.origin));
    }

    await upsertSubscriptionAndEntitlements(admin, user.id, stripeCustomerId, subscription);

    const plan = isPlanCode(fallbackPlan) ? fallbackPlan : "segna_plus";
    return NextResponse.redirect(new URL(`/exchange?subscription=success&plan=${plan}`, url.origin));
  } catch {
    return NextResponse.redirect(new URL("/exchange?subscription=error&reason=sync_failed", url.origin));
  }
}
