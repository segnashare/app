import type { SupabaseClient } from "@supabase/supabase-js";

const INTAKE_RECEIVED_SHIPMENT_STATUSES = new Set(["delivered", "returned", "en_verification"]);

/**
 * Après réception colis intake (RPC DB + filet app si transition OK mais promote manqué).
 */
export async function promoteIntakeInVerificationFromShipment(
  admin: SupabaseClient,
  shipmentId: string,
  opts?: { shipmentContext?: string; toStatus?: string },
): Promise<void> {
  const sid = shipmentId.trim();
  if (!sid) return;

  const ctx = (opts?.shipmentContext ?? "").trim().toLowerCase();
  const to = (opts?.toStatus ?? "").trim().toLowerCase();
  if (ctx && ctx !== "member_intake" && ctx !== "cart_return") return;
  if (to && !INTAKE_RECEIVED_SHIPMENT_STATUSES.has(to)) return;

  const { error } = await admin.rpc("promote_intake_items_to_in_verification_on_shipment_delivered", {
    p_shipment_id: sid,
  });
  if (error) {
    throw new Error(error.message);
  }
}
