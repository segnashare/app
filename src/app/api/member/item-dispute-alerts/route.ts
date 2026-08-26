import { NextResponse } from "next/server";

import {
  acknowledgeMemberItemDisputeAlert,
  fetchMemberPendingItemDisputeAlerts,
} from "@/lib/disputes/fetch-member-item-dispute-alerts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

export async function GET(request: Request) {
  const { user, error: userError } = await resolveRequestUserClient(request);
  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const alerts = await fetchMemberPendingItemDisputeAlerts(admin, user.id);
  return NextResponse.json({ alerts });
}

export async function POST(request: Request) {
  const { user, error: userError } = await resolveRequestUserClient(request);
  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { item_dispute_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const itemDisputeId = body.item_dispute_id?.trim() ?? "";
  if (!itemDisputeId) {
    return NextResponse.json({ error: "item_dispute_id_requis" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const result = await acknowledgeMemberItemDisputeAlert(admin, user.id, itemDisputeId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
