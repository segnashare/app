import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CreditKind = "pods" | "mods";

function isCreditKind(value: unknown): value is CreditKind {
  return value === "pods" || value === "mods";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.redirect(new URL("/profile?tab=plus&credits=error&reason=missing_session", url.origin));
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
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const expectedUserId =
      session.metadata?.user_id ?? (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
    if (expectedUserId && expectedUserId !== user.id) {
      return NextResponse.redirect(new URL("/profile?tab=plus&credits=error&reason=user_mismatch", url.origin));
    }

    const checkoutKind = session.metadata?.checkout_kind ?? null;
    if (checkoutKind !== "credits_purchase") {
      return NextResponse.redirect(new URL("/profile?tab=plus&credits=error&reason=wrong_checkout_kind", url.origin));
    }

    if (session.payment_status !== "paid") {
      return NextResponse.redirect(new URL("/profile?tab=plus&credits=error&reason=payment_not_paid", url.origin));
    }

    const creditKindRaw = session.metadata?.credits_kind ?? "pods";
    const creditsAmountRaw = Number(session.metadata?.credits_amount ?? 0);
    const creditKind: CreditKind = isCreditKind(creditKindRaw) ? creditKindRaw : "pods";
    const creditsAmount = Number.isFinite(creditsAmountRaw) ? Math.trunc(creditsAmountRaw) : 0;

    if (creditsAmount <= 0) {
      return NextResponse.redirect(new URL("/profile?tab=plus&credits=error&reason=invalid_amount", url.origin));
    }

    const { error: rpcError } = await admin.rpc("wallet_credit_purchase", {
      p_user_id: user.id,
      p_amount_points: creditsAmount,
      p_credit_kind: creditKind,
      p_provider: "stripe",
      p_checkout_session_id: session.id,
      p_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      p_idempotency_key: `stripe:credits_checkout:${session.id}`,
      p_metadata: {
        source: "credits_sync_route",
      },
    });
    if (rpcError) {
      return NextResponse.redirect(new URL("/profile?tab=plus&credits=error&reason=rpc_failed", url.origin));
    }

    return NextResponse.redirect(
      new URL(`/profile?tab=plus&credits=success&kind=${creditKind}&pack=${creditsAmount}`, url.origin),
    );
  } catch {
    return NextResponse.redirect(new URL("/profile?tab=plus&credits=error&reason=sync_failed", url.origin));
  }
}
