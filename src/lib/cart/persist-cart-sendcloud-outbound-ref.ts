import type { SupabaseClient } from "@supabase/supabase-js";

/** Persiste la référence commande Sendcloud aller sur le panier confirmé. */
export async function persistCartSendcloudOutboundRef(
  admin: SupabaseClient,
  cartId: string,
  input: {
    orderNumber: string;
    panelOrderId?: string | null;
    clearCancelledAt?: boolean;
  },
): Promise<void> {
  const orderNumber = input.orderNumber.trim();
  if (!orderNumber) return;

  const patch: Record<string, unknown> = {
    sendcloud_outbound_order_number: orderNumber,
  };
  if (input.panelOrderId !== undefined) {
    patch.sendcloud_outbound_panel_order_id = input.panelOrderId?.trim() || null;
  }
  if (input.clearCancelledAt) {
    patch.sendcloud_outbound_cancelled_at = null;
  }

  const { error } = await admin.from("carts").update(patch).eq("id", cartId.trim()).is("deleted_at", null);
  if (error) {
    console.error("[cart-order] persist cart sendcloud outbound ref failed", error.message, { cartId });
  }
}

/** Marque l’aller Sendcloud comme annulé côté panier (conserve le numéro de commande). */
export async function markCartSendcloudOutboundCancelled(
  admin: SupabaseClient,
  cartId: string,
  input?: { cancelledAt?: string; orderNumber?: string },
): Promise<void> {
  const cancelledAt = input?.cancelledAt ?? new Date().toISOString();
  const patch: Record<string, unknown> = {
    sendcloud_outbound_panel_order_id: null,
    sendcloud_outbound_cancelled_at: cancelledAt,
  };
  const orderNumber = input?.orderNumber?.trim();
  if (orderNumber) {
    patch.sendcloud_outbound_order_number = orderNumber;
  }
  const { error } = await admin
    .from("carts")
    .update(patch)
    .eq("id", cartId.trim())
    .is("deleted_at", null);
  if (error) {
    console.error("[cart-order] mark cart sendcloud outbound cancelled failed", error.message, { cartId });
  }
}
