import { NextResponse } from "next/server";

import { confirmSubscriptionCheckoutSession } from "@/lib/stripe/confirm-subscription-checkout";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

/**
 * Confirmation post-Checkout (Bearer website ou session app).
 * Body : `{ sessionId, planCode? }`
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
      planCode?: unknown;
    } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) {
      return NextResponse.json({ message: "session_id manquant." }, { status: 400 });
    }

    const { user, error: userError } = await resolveRequestUser(request);
    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const admin = createSupabaseAdminClient() as any;
    const result = await confirmSubscriptionCheckoutSession({
      admin,
      userId: user.id,
      sessionId,
      fallbackPlan: typeof body?.planCode === "string" ? body.planCode : null,
      checkoutMode: "sync",
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.reason }, { status: result.status });
    }

    return NextResponse.json({ ok: true, planCode: result.planCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de confirmer l’abonnement.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
