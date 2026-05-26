import { NextResponse } from "next/server";

import { fetchDefaultIntakeShippingGroupIds } from "@/lib/items/intake-cart-return-piggyback";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function parseFocusId(searchParams: URLSearchParams): string {
  return String(searchParams.get("focus_id") ?? searchParams.get("item_id") ?? "").trim();
}

export async function GET(request: Request) {
  const focusId = parseFocusId(new URL(request.url).searchParams);

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

  const ids = await fetchDefaultIntakeShippingGroupIds(admin, user.id, {
    focusItemId: focusId || null,
  });
  return NextResponse.json({ ok: true as const, item_ids: ids });
}
