import { NextResponse } from "next/server";

import { CHECKLIST_ITEMS } from "@/lib/onboarding/demo-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type OnboardingProgressRow = {
  check_profile_done: boolean;
  check_list_first_item_done: boolean;
  check_style_size_done: boolean;
  check_first_cart_done: boolean;
};

export async function POST() {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { data: progress, error: progressError } = await supabase
    .from("onboarding_progress")
    .select("check_profile_done, check_list_first_item_done, check_style_size_done, check_first_cart_done")
    .eq("user_id", user.id)
    .maybeSingle<OnboardingProgressRow>();

  if (progressError || !progress) {
    return NextResponse.json({ error: "Progression onboarding introuvable" }, { status: 404 });
  }

  const allDone = CHECKLIST_ITEMS.every((key) => progress[key]);
  if (!allDone) {
    return NextResponse.json({ error: "Checklist incomplète" }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("users")
    .update({ onboarding_mode: "bridge", onboarding_started_at: nowIso })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Impossible de démarrer le bridge" }, { status: 500 });
  }

  await supabase.from("onboarding_progress").update({ current_step: "bridge", updated_at: nowIso }).eq("user_id", user.id);

  return NextResponse.json({ ok: true, onboardingMode: "bridge" });
}
