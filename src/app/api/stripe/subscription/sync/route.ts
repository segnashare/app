import { NextResponse } from "next/server";

import { confirmSubscriptionCheckoutSession } from "@/lib/stripe/confirm-subscription-checkout";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

    const result = await confirmSubscriptionCheckoutSession({
      admin,
      userId: user.id,
      sessionId,
      fallbackPlan,
      checkoutMode: "sync",
    });

    if (!result.ok) {
      return NextResponse.redirect(
        new URL(`/exchange?subscription=error&reason=${encodeURIComponent(result.reason)}`, url.origin),
      );
    }

    return NextResponse.redirect(
      new URL(`/exchange?subscription=success&plan=${result.planCode}`, url.origin),
    );
  } catch {
    return NextResponse.redirect(new URL("/exchange?subscription=error&reason=sync_failed", url.origin));
  }
}
