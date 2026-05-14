import { NextResponse } from "next/server";

import { NotificationKind } from "@/lib/notifications/kinds";
import { buildOnboardingRewardCompletionSms } from "@/lib/notifications/onboarding-reward-sms";
import { sendMemberSmsOnlyNotification } from "@/lib/notifications/member-outreach";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Passe `users.onboarding_process` de `reward` à `finished` pour l’utilisateur connecté,
 * puis envoie un SMS transactionnel de félicitations (si Twilio + téléphone valide).
 */
export async function POST() {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { data: before, error: readError } = await supabase
    .from("users")
    .select("onboarding_process, first_name")
    .eq("id", user.id)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: "Impossible de lire le profil" }, { status: 500 });
  }

  const process = typeof before?.onboarding_process === "string" ? before.onboarding_process : null;
  if (process === "finished") {
    return NextResponse.json({ ok: true, alreadyFinished: true });
  }
  if (process !== "reward") {
    return NextResponse.json({ error: "Étape onboarding inattendue" }, { status: 409 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("users")
    .update({ onboarding_process: "finished" })
    .eq("id", user.id)
    .eq("onboarding_process", "reward")
    .select("id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: "Impossible de finaliser l’onboarding" }, { status: 500 });
  }
  if (!updated) {
    const { data: again } = await supabase.from("users").select("onboarding_process").eq("id", user.id).maybeSingle();
    if (again?.onboarding_process === "finished") {
      return NextResponse.json({ ok: true, alreadyFinished: true });
    }
    return NextResponse.json({ error: "Étape onboarding inattendue" }, { status: 409 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const smsBody = buildOnboardingRewardCompletionSms(before?.first_name ?? null);
    await sendMemberSmsOnlyNotification(admin, {
      userId: user.id,
      kind: NotificationKind.onboardingRewardComplete,
      idempotencyKey: `txn:onboarding_reward_complete_sms:${user.id}`,
      metadata: { source: "finish-reward" },
      smsBody,
      transactionalSms: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[onboarding/finish-reward] sms branch failed", msg);
  }

  return NextResponse.json({ ok: true });
}
