import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { returnTab?: unknown } | null;
    const tabRaw = typeof body?.returnTab === "string" ? body.returnTab.trim() : "";
    const returnTab = ["plus", "security", "me"].includes(tabRaw) ? tabRaw : "plus";

    const supabase = (await createSupabaseServerClient()) as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const admin = createSupabaseAdminClient() as any;
    const { data: billingRow, error: billingError } = await admin
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("provider", "stripe")
      .eq("user_id", user.id)
      .maybeSingle();

    if (billingError) {
      return NextResponse.json({ message: billingError.message }, { status: 500 });
    }

    const stripeCustomerId = typeof billingRow?.provider_customer_id === "string" ? billingRow.provider_customer_id.trim() : "";
    if (!stripeCustomerId) {
      return NextResponse.json(
        { message: "Aucun compte de facturation Stripe trouvé. Contacte le support si tu es abonné·e." },
        { status: 400 },
      );
    }

    const config = getStripeConfig();
    const stripe = new Stripe(config.secretKey);
    const returnUrl = `${config.returnUrlBase}/profile/settings?tab=${encodeURIComponent(returnTab)}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    if (!session.url) {
      return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL du portail." }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible d'ouvrir le portail d'abonnement.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
