import { NextResponse } from "next/server";

import { runMemberIntakePiggybackDepositDecisions } from "@/lib/items/intake-cart-return-piggyback";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function parseDecisions(raw: unknown): Array<{ item_id: string; in_box: boolean }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const item_id = String(o.item_id ?? "").trim();
      if (!item_id) return null;
      return { item_id, in_box: o.in_box === true };
    })
    .filter((x): x is { item_id: string; in_box: boolean } => x != null);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const returnShipmentId = String(o.return_shipment_id ?? o.shipment_id ?? "").trim();
  const decisions = parseDecisions(o.decisions);

  if (!returnShipmentId) {
    return NextResponse.json({ ok: false as const, error: "return_shipment_id requis" }, { status: 400 });
  }
  if (decisions.length === 0) {
    return NextResponse.json({ ok: false as const, error: "decisions requises" }, { status: 400 });
  }

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

  const res = await runMemberIntakePiggybackDepositDecisions(admin, {
    userId: user.id,
    returnShipmentId,
    decisions,
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false as const, error: res.error }, { status: res.status });
  }

  return NextResponse.json({ ok: true as const });
}
