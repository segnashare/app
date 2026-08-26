import { NextResponse } from "next/server";

import { declareUserRegisteredToN8n } from "@/lib/notifications/notify-ops-activity-n8n";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUser } from "@/lib/supabase/request-user";

/**
 * Déclare un nouveau compte membre vers Discord / n8n (idempotent).
 * Auth : cookies app ou `Authorization: Bearer` (website / mobile).
 */
export async function POST(request: Request) {
  const { user, error: userError } = await resolveRequestUser(request);
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let source = "client";
  try {
    const body = (await request.json()) as { source?: unknown };
    if (typeof body?.source === "string" && body.source.trim()) {
      source = body.source.trim().slice(0, 64);
    }
  } catch {
    // body optionnel
  }

  const admin = createSupabaseAdminClient();
  const result = await declareUserRegisteredToN8n(admin, { userId: user.id, source });
  return NextResponse.json({ ok: true as const, result });
}
