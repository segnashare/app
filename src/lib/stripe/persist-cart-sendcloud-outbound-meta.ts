import type { SupabaseClient } from "@supabase/supabase-js";

import type { SendcloudOutboundCheckoutMeta } from "@/lib/cart/checkout-sendcloud-outbound-option";

/** Persiste le transporteur aller choisi au checkout sur `shipment_destinations.metadata`. */
export async function persistCartOutboundSendcloudCheckoutMeta(
  admin: SupabaseClient,
  cartId: string,
  meta: SendcloudOutboundCheckoutMeta,
): Promise<void> {
  const { data: ship, error: shipErr } = await admin
    .from("shipments")
    .select("id")
    .eq("cart_id", cartId.trim())
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (shipErr || !ship?.id) return;

  const { data: dest, error: destErr } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", ship.id)
    .limit(1)
    .maybeSingle();

  if (destErr || !dest?.id) return;

  const prev =
    dest.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};

  const { error: updErr } = await admin
    .from("shipment_destinations")
    .update({
      metadata: {
        ...prev,
        ...meta,
      },
    })
    .eq("id", dest.id);

  if (updErr) {
    console.error("[cart-order] persist sendcloud outbound meta failed", updErr.message);
  }
}
