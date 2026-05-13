import type { SupabaseClient } from "@supabase/supabase-js";

import {
  checkoutMetaIndicatesUberDirect,
  isUberCartOutboundShipment,
} from "@/lib/cart/cart-outbound-delivery-kind";

/**
 * Livraison aller « domicile Uber » (pas de retrait relais côté aller) : metadata facture Stripe et/ou
 * expédition aller (provider, suivi). Sert à ne pas envoyer de SMS « dépôt point relais » inadaptés.
 */
export async function loadCartUsesUberHomeDelivery(admin: SupabaseClient, cartId: string): Promise<boolean> {
  const { data: inv } = await admin
    .from("cart_order_stripe_invoices")
    .select("checkout_delivery_channel, checkout_home_speed")
    .eq("cart_id", cartId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inv && typeof inv === "object") {
    const row = inv as { checkout_delivery_channel?: string | null; checkout_home_speed?: string | null };
    if (checkoutMetaIndicatesUberDirect(row.checkout_delivery_channel, row.checkout_home_speed)) {
      return true;
    }
  }

  const { data: ship } = await admin
    .from("shipments")
    .select("member_tracking_url, tracking_number, shipment_providers(code)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ship || typeof ship !== "object") return false;
  const row = ship as Record<string, unknown>;
  const providers = row.shipment_providers;
  const provObj = Array.isArray(providers) ? providers[0] : providers;
  const code =
    provObj && typeof provObj === "object" && typeof (provObj as { code?: unknown }).code === "string"
      ? String((provObj as { code: string }).code).trim().toLowerCase()
      : null;

  return isUberCartOutboundShipment({
    outboundProviderCode: code,
    memberTrackingUrl: typeof row.member_tracking_url === "string" ? row.member_tracking_url : null,
    trackingNumber: typeof row.tracking_number === "string" ? row.tracking_number : null,
  });
}
