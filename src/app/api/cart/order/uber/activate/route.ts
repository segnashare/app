import { NextResponse } from "next/server";

import { launchUberDirectForCartOutboundReady } from "@/lib/uber-direct/launch-uber-for-cart-ready";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isOutboundHomeDestination(dest: Record<string, unknown> | null | undefined): boolean {
  if (!dest || typeof dest !== "object") return false;
  const t = String(dest.destination_type ?? "").toLowerCase();
  if (t === "home") return true;
  if (t === "pickup_point") return false;
  const relay = typeof dest.provider_point_id === "string" && dest.provider_point_id.trim().length > 0;
  if (relay) return false;
  return typeof dest.line1 === "string" && dest.line1.trim().length > 0;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }
  const cartId = typeof (body as { cartId?: unknown })?.cartId === "string" ? (body as { cartId: string }).cartId : "";
  if (!CART_ID_RE.test(cartId)) {
    return NextResponse.json({ ok: false as const, error: "cart_id_invalid" }, { status: 400 });
  }

  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  const { data: cart } = await supabase
    .from("carts")
    .select("id, user_id")
    .eq("id", cartId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cart) {
    return NextResponse.json({ ok: false as const, error: "forbidden_or_not_found" }, { status: 403 });
  }

  const { data: ship } = await supabase
    .from("shipments")
    .select("member_tracking_url, shipment_providers(code), shipment_destinations(destination_type, provider_point_id, line1)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ship || typeof ship !== "object") {
    return NextResponse.json({ ok: false as const, error: "shipment_not_found" }, { status: 404 });
  }

  const memberTrackingUrl = String((ship as { member_tracking_url?: unknown }).member_tracking_url ?? "").trim();
  if (memberTrackingUrl) {
    return NextResponse.json({ ok: true as const, status: "already_active" as const });
  }
  const provEmb = (ship as { shipment_providers?: unknown }).shipment_providers;
  const provObj = Array.isArray(provEmb) ? provEmb[0] : provEmb;
  const provCode =
    provObj && typeof provObj === "object" ? String((provObj as { code?: unknown }).code ?? "").toLowerCase() : "";
  const destEmb = (ship as { shipment_destinations?: unknown }).shipment_destinations;
  const destObj = Array.isArray(destEmb) ? destEmb[0] : destEmb;
  const isHome = isOutboundHomeDestination(destObj && typeof destObj === "object" ? (destObj as Record<string, unknown>) : null);
  if (provCode !== "uber_direct" && !isHome) {
    return NextResponse.json({ ok: false as const, error: "not_uber_delivery" }, { status: 409 });
  }

  const admin = createSupabaseAdminClient() as any;
  const uber = await launchUberDirectForCartOutboundReady(admin, cartId);
  return NextResponse.json({ ok: true as const, uber });
}
