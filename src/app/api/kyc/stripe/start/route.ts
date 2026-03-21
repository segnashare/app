import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = (await createSupabaseServerClient()) as any;
    const admin = createSupabaseAdminClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const { data: profileRow, error: profileError } = await admin.from("user_profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (profileError || !profileRow?.id) {
      return NextResponse.json({ message: "Profil introuvable." }, { status: 400 });
    }

    const config = getStripeConfig();
    const stripe = new Stripe(config.secretKey);

    const returnUrl = `${config.returnUrlBase}/profile/kyc?tab=security&kyc=processing`;
    const verificationSession = await stripe.identity.verificationSessions.create({
      type: "document",
      return_url: returnUrl,
      metadata: {
        user_id: user.id,
        user_profile_id: profileRow.id,
      },
    });

    const payload = {
      stripe: {
        verification_session_id: verificationSession.id,
        url: verificationSession.url ?? null,
        status: verificationSession.status ?? null,
      },
    };

    const {
      data: existingRow,
      error: existingRowError,
    } = await admin
      .from("user_identity_verifications")
      .select("id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingRowError) {
      return NextResponse.json({ message: existingRowError.message }, { status: 500 });
    }

    if (existingRow?.id) {
      const { error: updateVerificationError } = await admin
        .from("user_identity_verifications")
        .update({
          provider: "stripe",
          verification_status: "pending",
          payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingRow.id);
      if (updateVerificationError) {
        return NextResponse.json({ message: updateVerificationError.message }, { status: 500 });
      }
    } else {
      const { error: insertVerificationError } = await admin.from("user_identity_verifications").insert({
        user_id: user.id,
        provider: "stripe",
        verification_status: "pending",
        payload,
      });
      if (insertVerificationError) {
        return NextResponse.json({ message: insertVerificationError.message }, { status: 500 });
      }
    }

    if (!verificationSession.url) {
      return NextResponse.json({ message: "Stripe n'a pas renvoyé d'URL de vérification." }, { status: 500 });
    }

    return NextResponse.json({ url: verificationSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer la vérification KYC.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
