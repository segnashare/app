import { NextResponse } from "next/server";

import { runCartReturnSendcloudAutoGenerate } from "@/lib/cart/cart-return-sendcloud-auto-generate";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const cartId = typeof o.cart_id === "string" ? o.cart_id.trim() : "";
  if (!CART_ID_RE.test(cartId)) {
    return NextResponse.json({ ok: false as const, error: "cart_id invalide" }, { status: 400 });
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

  const res = await runCartReturnSendcloudAutoGenerate(admin, { userId: user.id, cartId });
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false as const,
        error: res.error,
        ...(res.developer_hint ? { developer_hint: res.developer_hint } : {}),
      },
      { status: res.status },
    );
  }

  return NextResponse.json({
    ok: true as const,
    shipment_id: res.shipment_id,
    label_url: res.label_url,
    numero_suivi: res.numero_suivi,
    ...(res.reused ? { reused: true as const } : {}),
  });
}
