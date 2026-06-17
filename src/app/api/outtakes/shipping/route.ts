import { NextResponse } from "next/server";

import {
  ensureAutoOuttakeGroupsForUser,
  fetchOuttakeGroupsForShipping,
} from "@/lib/items/member-outtake-groups";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const skipAuto = searchParams.get("skip_auto") === "1";

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false as const, error: "Authentification requise" }, { status: 401 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Service indisponible" }, { status: 503 });
  }

  const groups = await fetchOuttakeGroupsForShipping(admin, user.id);
  if (groups.length > 0 || skipAuto) {
    return NextResponse.json({ ok: true as const, groups });
  }

  const ensured = await ensureAutoOuttakeGroupsForUser(admin, user.id);
  if (ensured.ok) {
    return NextResponse.json({ ok: true as const, groups: ensured.groups });
  }

  const afterEnsure = await fetchOuttakeGroupsForShipping(admin, user.id);
  if (afterEnsure.length > 0) {
    return NextResponse.json({ ok: true as const, groups: afterEnsure });
  }

  return NextResponse.json({ ok: false as const, error: ensured.error }, { status: 400 });
}
