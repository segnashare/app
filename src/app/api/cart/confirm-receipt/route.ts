import { NextResponse } from "next/server";

import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: { cartId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const cartId = String(body.cartId ?? "").trim();
  if (!CART_ID_RE.test(cartId)) {
    return NextResponse.json({ error: "Identifiant de commande invalide" }, { status: 400 });
  }

  const userId = user.id as string;

  const { data: cart, error: cartErr } = await supabase
    .from("carts")
    .select("id,user_id,status,member_receipt_confirmed_at")
    .eq("id", cartId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (cartErr) {
    return NextResponse.json({ error: "Lecture commande impossible." }, { status: 500 });
  }
  if (!cart) {
    return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  }

  const { data: outbound } = await supabase
    .from("shipments")
    .select("status")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const outboundStatus = String((outbound as { status?: string } | null)?.status ?? "").toLowerCase();
  if (outboundStatus !== "delivered") {
    return NextResponse.json(
      { error: "La validation est disponible une fois ta commande livrée." },
      { status: 409 },
    );
  }

  const already = (cart as { member_receipt_confirmed_at?: string | null }).member_receipt_confirmed_at;
  if (already) {
    return NextResponse.json({ ok: true, alreadyConfirmed: true });
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("carts")
    .update({ member_receipt_confirmed_at: nowIso, updated_at: nowIso })
    .eq("id", cartId);

  if (upErr) {
    return NextResponse.json({ error: "Enregistrement impossible. Réessaie." }, { status: 500 });
  }

  trackServerEvent(
    ANALYTICS_EVENTS.orderReceived,
    {
      distinctId: userId,
      insertId: `order_received:${cartId}`,
    },
    { cart_id: cartId, manual_confirm: true },
  );
  await flushServerAnalytics();

  return NextResponse.json({ ok: true, alreadyConfirmed: false });
}
