import type { SupabaseClient } from "@supabase/supabase-js";

import { cancelCartOutboundSendcloudOrder } from "@/lib/cart/cancel-cart-outbound-sendcloud-order";
import { cancelCartReturnSendcloudOrder } from "@/lib/cart/cancel-cart-return-sendcloud-order";

export type CancelCartSendcloudOrdersResult = {
  ok: boolean;
  notices: string[];
};

/** Archive (soft-delete) les expéditions aller + retour d’un panier annulé (`closed` + `deleted_at`). */
export async function archiveCartShipmentsAfterCancel(
  admin: SupabaseClient,
  cartId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("shipments")
    .update({
      status: "closed",
      deleted_at: now,
      updated_at: now,
    })
    .eq("cart_id", cartId.trim())
    .in("context", ["cart_outbound", "cart_return"])
    .is("deleted_at", null);

  if (error) {
    console.error("[cart-cancel] archive shipments failed", error.message, { cartId });
  }
}

/**
 * Annule les commandes / colis Sendcloud aller + retour (à appeler **avant** le RPC d’annulation panier,
 * tant que les shipments sont encore actifs en base).
 */
export async function cancelCartSendcloudOrdersForCart(
  admin: SupabaseClient,
  cartId: string,
): Promise<CancelCartSendcloudOrdersResult> {
  const notices: string[] = [];

  const outbound = await cancelCartOutboundSendcloudOrder(admin, cartId);
  notices.push(...outbound.notices);

  const retour = await cancelCartReturnSendcloudOrder(admin, cartId);
  notices.push(...retour.notices);

  return { ok: true, notices };
}

/** Sendcloud puis archivage shipments (flux complet si le RPC n’archive pas déjà). */
export async function cancelCartSendcloudOrdersOnCancel(
  admin: SupabaseClient,
  cartId: string,
): Promise<CancelCartSendcloudOrdersResult> {
  const result = await cancelCartSendcloudOrdersForCart(admin, cartId);
  await archiveCartShipmentsAfterCancel(admin, cartId);
  return result;
}
