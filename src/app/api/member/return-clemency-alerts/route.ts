import { NextResponse } from "next/server";

import {
  acknowledgeMemberReturnClemencyAlert,
  fetchMemberPendingReturnClemencyAlerts,
} from "@/lib/cart/fetch-member-return-clemency-alerts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

export async function GET(request: Request) {
  const { user, error: userError } = await resolveRequestUserClient(request);
  if (userError || !user) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const alerts = await fetchMemberPendingReturnClemencyAlerts(admin, user.id);
  return NextResponse.json({ ok: true as const, alerts });
}

export async function POST(request: Request) {
  const { user, error: userError } = await resolveRequestUserClient(request);
  if (userError || !user) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { cart_item_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }
  const cartItemId = typeof body.cart_item_id === "string" ? body.cart_item_id.trim() : "";
  if (!cartItemId) {
    return NextResponse.json({ ok: false as const, error: "cart_item_id_required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const result = await acknowledgeMemberReturnClemencyAlert(admin, user.id, cartItemId);
  if (!result.ok) {
    const status = result.error === "forbidden" ? 403 : result.error === "line_not_found" ? 404 : 400;
    return NextResponse.json({ ok: false as const, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true as const });
}
