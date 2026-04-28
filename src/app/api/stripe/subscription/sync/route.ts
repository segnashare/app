import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { upsertBillingCustomer, upsertSubscriptionAndEntitlements } from "@/lib/stripe/subscription-state";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isPlanCode(value: string | null | undefined): value is "guest" | "segna_plus" | "segna_x" {
  return value === "guest" || value === "segna_plus" || value === "segna_x";
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
      return NextResponse.redirect(new URL("/auth/login", url.origin));
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
