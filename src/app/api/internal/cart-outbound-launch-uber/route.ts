import { NextResponse } from "next/server";

import { launchCoursierForCartOutboundReady } from "@/lib/coursier/launch-coursier-for-cart-ready";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Appel serveur-à-serveur (ex. back-office après « colis prêt ») : passe commande Coursier si l’aller est `ready` et la commande était express domicile.
 * Auth : `Authorization: Bearer ${SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET}`.
 */
export async function POST(request: Request) {
  const expected = process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ?? "";
  if (!expected) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { cart_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const cartId = String(body.cart_id ?? "").trim();
  if (!isUuid(cartId)) {
    return NextResponse.json({ ok: false as const, error: "cart_id_invalid" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient() as any;
  const coursier = await launchCoursierForCartOutboundReady(admin, cartId);
  return NextResponse.json({ ok: true as const, coursier, uber: coursier });
}
