import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { trackOnboardingInAppStepServer } from "@/lib/analytics/track-onboarding-in-app-step-server";
import { flushServerAnalytics } from "@/lib/analytics/track-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

type VerificationStatus = "not_started" | "pending" | "in_review" | "verified" | "rejected";

function mapStripeStatusToVerificationStatus(status: Stripe.Identity.VerificationSession.Status): VerificationStatus {
  if (status === "verified") return "verified";
  if (status === "requires_input" || status === "canceled") return "rejected";
  if (status === "processing") return "in_review";
  return "pending";
}

export async function POST(request: Request) {
  try {
    const { user, error: userError } = await resolveRequestUser(request);
    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const admin = createSupabaseAdminClient() as any;
    const { data: verificationRow, error: verificationRowError } = await admin
      .from("user_identity_verifications")
      .select("id,payload")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (verificationRowError) {
      return NextResponse.json({ message: verificationRowError.message }, { status: 500 });
    }
    if (!verificationRow?.id) {
      return NextResponse.json({ verificationStatus: "not_started" as VerificationStatus });
    }

    const payload = (verificationRow.payload ?? {}) as Record<string, unknown>;
    const stripePayload = (payload.stripe ?? {}) as Record<string, unknown>;
    const sessionId = typeof stripePayload.verification_session_id === "string" ? stripePayload.verification_session_id : "";
    if (!sessionId) {
      return NextResponse.json({ verificationStatus: "not_started" as VerificationStatus });
    }

    const config = getStripeConfig();
    const stripe = new Stripe(config.secretKey);
    const session = await stripe.identity.verificationSessions.retrieve(sessionId);
    const verificationStatus = mapStripeStatusToVerificationStatus(session.status);

    const nextPayload = {
      ...payload,
      stripe: {
        ...stripePayload,
        status: session.status,
        last_response: {
          verified_outputs: session.verified_outputs ?? null,
          last_error: session.last_error ?? null,
        },
      },
    };

    const { error: updateError } = await admin
      .from("user_identity_verifications")
      .update({
        provider: "stripe",
        verification_status: verificationStatus,
        payload: nextPayload,
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", verificationRow.id);
    if (updateError) {
      return NextResponse.json({ message: updateError.message }, { status: 500 });
    }

    if (verificationStatus === "verified") {
      const { error: onboardingUpdateError } = await admin
        .from("users")
        .update({ onboarding_process: "panier" })
        .eq("id", user.id)
        .eq("onboarding_process", "kyc");
      if (onboardingUpdateError) {
        return NextResponse.json({ message: onboardingUpdateError.message }, { status: 500 });
      }
      trackOnboardingInAppStepServer(user.id, {
        fromStep: "kyc",
        toStep: "panier",
        trigger: "kyc_verified",
      });
      await flushServerAnalytics();
    }

    return NextResponse.json({
      verificationStatus,
      stripeStatus: session.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de synchroniser le statut KYC.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
