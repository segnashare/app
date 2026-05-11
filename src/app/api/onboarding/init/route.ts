import { NextResponse } from "next/server";

import { getDefaultOnboardingDemoState } from "@/lib/onboarding/demo-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type UserOnboardingState = {
  onboarding_mode: "demo" | "bridge" | "real";
  onboarding_completed_at: string | null;
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

  const { data: userRowRaw, error: userRowError } = await supabase
    .from("users")
    .select("onboarding_mode, onboarding_completed_at")
    .eq("id", user.id)
    .maybeSingle();
  const userRow = userRowRaw as UserOnboardingState | null;

  if (userRowError) {
    return NextResponse.json({ error: "Impossible de lire l'état onboarding" }, { status: 500 });
  }

  const nowIso = new Date().toISOString();

  const { error: progressError } = await supabase.from("onboarding_progress").upsert(
    {
      user_id: user.id,
      current_step: "welcome",
      demo_seeded: true,
      started_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );

  if (progressError) {
    return NextResponse.json({ error: "Impossible d'initialiser la progression onboarding" }, { status: 500 });
  }

  const { error: demoStateError } = await supabase.from("onboarding_demo_state").upsert(
    {
      user_id: user.id,
      data: getDefaultOnboardingDemoState(),
      updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );

  if (demoStateError) {
    return NextResponse.json({ error: "Impossible d'initialiser les données démo" }, { status: 500 });
  }

  const { error: modeError } = await supabase
    .from("users")
    .update({ onboarding_mode: "demo", onboarding_started_at: nowIso })
    .eq("id", user.id);

  if (modeError) {
    return NextResponse.json({ error: "Impossible d'activer le mode démo" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    onboardingMode: "demo",
    seededFromCompletedOnboarding: Boolean(userRow?.onboarding_completed_at),
  });
}
