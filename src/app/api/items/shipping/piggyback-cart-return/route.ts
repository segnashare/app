import { NextResponse } from "next/server";

import {
  runIntakeCartReturnPiggybackConfirm,
  runIntakeCartReturnPiggybackRevertToPortal,
} from "@/lib/items/intake-cart-return-piggyback";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function parseItemIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const itemIds = parseItemIds(o.item_ids);
  const cartId = String(o.cart_id ?? "").trim();
  const useReturnPortal = o.use_return_portal === true;

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

  if (useReturnPortal) {
    const res = await runIntakeCartReturnPiggybackRevertToPortal(admin, { userId: user.id, itemIds });
    if (!res.ok) {
      return NextResponse.json({ ok: false as const, error: res.error }, { status: res.status });
    }
    return NextResponse.json({ ok: true as const, mode: "return_portal" });
  }

  if (!cartId) {
    return NextResponse.json({ ok: false as const, error: "cart_id requis" }, { status: 400 });
  }

  const res = await runIntakeCartReturnPiggybackConfirm(admin, {
    userId: user.id,
    itemIds,
    cartId,
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false as const, error: res.error }, { status: res.status });
  }

  return NextResponse.json({
    ok: true as const,
    mode: "cart_return_piggyback",
    cart_id: res.cart_id,
    return_shipment_id: res.return_shipment_id,
  });
}
