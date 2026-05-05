import { NextResponse } from "next/server";

import { getDefaultOnboardingDemoState } from "@/lib/onboarding/demo-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { data: row, error } = await supabase
    .from("onboarding_demo_state")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle<{ data: unknown }>();

  if (error) {
    return NextResponse.json({ error: "Impossible de lire les données démo" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    demoState: row?.data ?? getDefaultOnboardingDemoState(),
  });
}
