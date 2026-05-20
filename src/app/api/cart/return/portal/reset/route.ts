import { NextResponse } from "next/server";

import { runCartReturnPortalReset } from "@/lib/cart/member-cart-return-portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const cartId = String(o.cart_id ?? "").trim();
  if (!cartId) {
    return NextResponse.json({ ok: false as const, error: "cart_id requis" }, { status: 400 });
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

  const res = await runCartReturnPortalReset(admin, { userId: user.id, cartId });
  if (!res.ok) {
    return NextResponse.json({ ok: false as const, error: res.error }, { status: res.status });
  }

  return NextResponse.json({ ok: true as const });
}
