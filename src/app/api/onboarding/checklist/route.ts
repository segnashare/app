import { NextResponse } from "next/server";

import { CHECKLIST_ITEMS, type OnboardingChecklistItem } from "@/lib/onboarding/demo-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RequestBody = {
  item?: string;
  value?: boolean;
};

type OnboardingProgressRow = {
  check_profile_done: boolean;
  check_list_first_item_done: boolean;
  check_style_size_done: boolean;
  check_first_cart_done: boolean;
};

function isChecklistItem(value: string): value is OnboardingChecklistItem {
  return CHECKLIST_ITEMS.includes(value as OnboardingChecklistItem);
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const item = (body.item ?? "").trim();
  if (!isChecklistItem(item)) {
    return NextResponse.json({ error: "Checklist item invalide" }, { status: 400 });
  }

  const value = body.value ?? true;

  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("onboarding_progress")
    .update({ [item]: value, updated_at: nowIso })
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Impossible de mettre à jour la checklist" }, { status: 500 });
  }

  const { data: progress, error: progressError } = await supabase
    .from("onboarding_progress")
    .select("check_profile_done, check_list_first_item_done, check_style_size_done, check_first_cart_done")
    .eq("user_id", user.id)
    .maybeSingle<OnboardingProgressRow>();

  if (progressError || !progress) {
    return NextResponse.json({ error: "Impossible de lire la checklist" }, { status: 500 });
  }

  const allDone = CHECKLIST_ITEMS.every((key) => progress[key]);

  if (allDone) {
    await supabase.from("onboarding_progress").update({ current_step: "review", updated_at: nowIso }).eq("user_id", user.id);
  }

  return NextResponse.json({
    ok: true,
    checklist: progress,
    allDone,
  });
}
