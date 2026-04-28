import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getStripeConfig } from "@/lib/social/stripe";
import { tryCreateUberDirectFromStripeSession, type UberDirectStripePostResult } from "@/lib/uber-direct/from-stripe-session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUberHomeInvoiceRow(row: {
  checkout_delivery_channel?: string | null;
  checkout_home_speed?: string | null;
}): boolean {
  const ch = (row.checkout_delivery_channel ?? "").trim().toLowerCase();
  if (ch !== "home") return false;
  const hs = (row.checkout_home_speed ?? "").trim().toLowerCase();
  return hs === "uber_direct" || hs === "priority";
}

function looksLikeUberDeliveryTracking(id: string | null | undefined): boolean {
  if (!id || !id.trim()) return false;
  const t = id.trim();
  if (t.startsWith("del_")) return true;
  return UUID_RE.test(t);
}

/**
 * Crée la livraison Uber Direct **après** passage de l’expédition aller en `ready` (colis préparé côté logistique).
 * Ne pas appeler au paiement Stripe : Uber ne doit prendre le colis qu’une fois prêt à l’enlèvement.
 */
export async function launchUberDirectForCartOutboundReady(
  admin: SupabaseClient,
  cartId: string,
): Promise<UberDirectStripePostResult> {
  const { data: ship, error: shipErr } = await admin
    .from("shipments")
    .select("id, status, tracking_number, provider_id")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shipErr || !ship || typeof ship !== "object") {
    console.warn("[uber-direct] launch ready : pas d’expédition aller", cartId, shipErr?.message);
    return { status: "not_applicable" };
  }

  const st = String((ship as { status?: string }).status ?? "").toLowerCase();
  if (st !== "ready") {
    console.warn("[uber-direct] launch ready : statut aller ≠ ready", cartId, st);
    return { status: "not_applicable" };
  }

  const tracking = (ship as { tracking_number?: string | null }).tracking_number;
  if (looksLikeUberDeliveryTracking(typeof tracking === "string" ? tracking : null)) {
    console.log("[uber-direct] launch ready : livraison déjà liée (tracking)", cartId);
    return { status: "duplicate_ignored" };
  }

  const providerId = (ship as { provider_id?: string | null }).provider_id;
  if (providerId) {
    const { data: prov } = await admin.from("shipment_providers").select("code").eq("id", providerId).maybeSingle();
    const code = prov && typeof prov === "object" ? String((prov as { code?: string }).code ?? "").toLowerCase() : "";
    if (code === "uber_direct") {
      console.log("[uber-direct] launch ready : provider déjà Uber", cartId);
      return { status: "duplicate_ignored" };
    }
  }

  const { data: inv, error: invErr } = await admin
    .from("cart_order_stripe_invoices")
    .select("checkout_session_id, user_id, checkout_delivery_channel, checkout_home_speed")
    .eq("cart_id", cartId)
    .maybeSingle();

  if (invErr || !inv || typeof inv !== "object") {
    console.warn("[uber-direct] launch ready : pas de facture panier Stripe", cartId, invErr?.message);
    return { status: "not_applicable" };
  }

  const row = inv as {
    checkout_session_id?: string | null;
    user_id?: string | null;
    checkout_delivery_channel?: string | null;
    checkout_home_speed?: string | null;
  };

  if (!isUberHomeInvoiceRow(row)) {
    return { status: "not_applicable" };
  }

  const sessionId = typeof row.checkout_session_id === "string" ? row.checkout_session_id.trim() : "";
  const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
  if (!userId || !sessionId.startsWith("cs_")) {
    console.warn(
      "[uber-direct] launch ready : session Checkout absente ou mode sans Stripe (wallet) — Uber non lancé",
      cartId,
    );
    return { status: "not_applicable" };
  }

  let session: Stripe.Checkout.Session;
  try {
    const { secretKey } = getStripeConfig();
    const stripe = new Stripe(secretKey);
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[uber-direct] launch ready : retrieve Stripe session", msg);
    return { status: "failed", error: `stripe_retrieve:${msg.slice(0, 200)}` };
  }

  return tryCreateUberDirectFromStripeSession(admin, session, userId);
}
