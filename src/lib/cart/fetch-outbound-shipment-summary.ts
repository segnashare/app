export type OutboundShipmentSummary = {
  cartId: string;
  shipmentId: string;
  status: string;
  trackingNumber: string | null;
};

/**
 * Dernier panier confirmé + résumé expédition aller (RPC `get_cart_outbound_shipment_summary`).
 */
export async function fetchLatestConfirmedCartOutboundShipmentSummary(
  supabase: {
    from: (table: string) => any;
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  },
  userId: string,
): Promise<OutboundShipmentSummary | null> {
  const cartRes = await supabase
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const cartRow = cartRes.data as { id?: string } | null;
  const cartId = cartRow?.id;
  if (!cartId) return null;

  const rpcRes = await supabase.rpc("get_cart_outbound_shipment_summary", { p_cart_id: cartId });
  if (rpcRes.error) return null;

  const row = rpcRes.data as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;

  const shipmentId = row.shipment_id;
  const status = row.status;
  if (typeof shipmentId !== "string" || typeof status !== "string") return null;

  const tn = row.tracking_number;
  const trackingNumber =
    tn == null ? null : typeof tn === "string" && tn.trim() !== "" ? tn.trim() : null;

  return {
    cartId,
    shipmentId,
    status,
    trackingNumber,
  };
}
