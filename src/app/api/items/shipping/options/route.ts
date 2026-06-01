import { NextResponse } from "next/server";

import { fetchIntakeShippingOptions } from "@/lib/items/intake-cart-return-piggyback";
import { MEMBER_INTAKE_SHIPMENT_MAX_ITEMS } from "@/lib/items/member-intake-shipment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function parseItemIds(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get("item_ids") ?? searchParams.get("ids") ?? "";
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))].sort();
}

export async function GET(request: Request) {
  const itemIds = parseItemIds(new URL(request.url).searchParams);
  if (itemIds.length < 1 || itemIds.length > MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) {
    return NextResponse.json(
      { ok: false as const, error: `Entre 1 et ${MEMBER_INTAKE_SHIPMENT_MAX_ITEMS} pièces requises.` },
      { status: 400 },
    );
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

  const snapshot = await fetchIntakeShippingOptions(admin, user.id, itemIds);
  return NextResponse.json({ ok: true as const, ...snapshot });
}
