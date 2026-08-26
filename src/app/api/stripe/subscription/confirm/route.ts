import { NextResponse } from "next/server";

import {
  confirmSubscriptionById,
  confirmSubscriptionCheckoutSession,
} from "@/lib/stripe/confirm-subscription-checkout";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

/**
 * Confirmation post-Checkout ou post-Payment Sheet (Bearer website ou session app).
 * Body : `{ sessionId, planCode? }` ou `{ subscriptionId, planCode? }`
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
      subscriptionId?: unknown;
      planCode?: unknown;
    } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    const subscriptionId =
      typeof body?.subscriptionId === "string" ? body.subscriptionId.trim() : "";
    if (!sessionId && !subscriptionId) {
      return NextResponse.json(
        { message: "session_id ou subscription_id manquant." },
        { status: 400 },
      );
    }

    const { user, error: userError } = await resolveRequestUser(request);
    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const admin = createSupabaseAdminClient() as any;
    const fallbackPlan = typeof body?.planCode === "string" ? body.planCode : null;

    const result = subscriptionId
      ? await confirmSubscriptionById({
          admin,
          userId: user.id,
          subscriptionId,
          fallbackPlan,
        })
      : await confirmSubscriptionCheckoutSession({
          admin,
          userId: user.id,
          sessionId,
          fallbackPlan,
          checkoutMode: "sync",
        });

    if (!result.ok) {
      return NextResponse.json(
        { message: result.detail ?? result.reason, code: result.reason },
        { status: result.status },
      );
    }

    return NextResponse.json({ ok: true, planCode: result.planCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de confirmer l’abonnement.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
