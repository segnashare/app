import { NextResponse } from "next/server";

import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";
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

  const { data: cart } = await admin
    .from("carts")
    .select("id,user_id,status")
    .eq("id", cartId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cart || cart.user_id !== user.id) {
    return NextResponse.json({ ok: false as const, error: "Panier introuvable" }, { status: 404 });
  }
  if (cart.status !== "confirmed") {
    return NextResponse.json({ ok: false as const, error: "Panier non éligible." }, { status: 400 });
  }

  const { data: ret } = await admin
    .from("shipments")
    .select("id,status")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ret?.id) {
    return NextResponse.json({ ok: false as const, error: "Aucune expédition retour — génère d’abord l’étiquette." }, { status: 400 });
  }
  const st = String(ret.status ?? "").toLowerCase();
  if (st !== "ready") {
    return NextResponse.json(
      { ok: false as const, error: `Action réservée après étiquette (« ready »). Statut actuel : ${st}.` },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const tr = await transitionShipmentStatus(admin, {
    shipmentId: ret.id,
    ifCurrentStatus: "ready",
    toStatus: "dropped_out",
    actorUserId: user.id,
    reason: "Membre indique dépôt au relais (retour)",
    source: "member_app_cart_return_mark_dropped_out",
    context: { route: "POST /api/cart/return/mark-dropped-out", cart_id: cartId },
    occurredAt: nowIso,
  });
  if (!tr.ok) {
    if (tr.error === "STATUS_MISMATCH") {
      return NextResponse.json(
        { ok: false as const, error: "Mise à jour impossible (statut modifié entre-temps)." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false as const, error: tr.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true as const, shipment_id: ret.id, status: "dropped_out" as const });
}
