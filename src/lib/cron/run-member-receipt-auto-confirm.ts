import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ensureMemberReceiptAutoConfirmed,
  isMemberReceiptAutoConfirmDue,
  memberReceiptAnchorFromOutboundShipment,
} from "@/lib/cart/member-receipt-validation";
import { trackOrderReceivedServer } from "@/lib/analytics/track-order-received-server";
import { resolveOutboundBorrowDeliveredAtIso } from "@/lib/emprunt/borrow-period";

const MAX_CARTS = 400;
const OUTBOUND_FETCH_MULT = 3;

type OutboundRow = {
  cart_id?: string;
  status?: string;
  updated_at?: string;
  delivered_at?: string | null;
};

type CartRow = {
  id: string;
  user_id: string;
  member_receipt_confirmed_at?: string | null;
};

/**
 * Auto-validation « bonne réception » (24 h après livraison aller).
 * Idempotent : ne met à jour que les paniers sans `member_receipt_confirmed_at`.
 */
export async function runMemberReceiptAutoConfirm(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{ scanned: number; confirmed: number; skipped: number; errors: number }> {
  const { data: outboundRows, error: oErr } = await admin
    .from("shipments")
    .select("cart_id,status,updated_at,delivered_at")
    .eq("context", "cart_outbound")
    .eq("status", "delivered")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_CARTS * OUTBOUND_FETCH_MULT);

  if (oErr) throw new Error(oErr.message);

  const latestOutboundByCart = new Map<string, OutboundRow>();
  for (const row of (outboundRows ?? []) as OutboundRow[]) {
    const cid = typeof row.cart_id === "string" ? row.cart_id : "";
    const anchor = resolveOutboundBorrowDeliveredAtIso(row.delivered_at, row.updated_at);
    if (!cid || !anchor) continue;
    const prev = latestOutboundByCart.get(cid);
    const prevAnchor = prev
      ? resolveOutboundBorrowDeliveredAtIso(prev.delivered_at, prev.updated_at)
      : null;
    if (!prev || !prevAnchor || new Date(anchor) > new Date(prevAnchor)) {
      latestOutboundByCart.set(cid, row);
    }
  }

  const cartIds = [...latestOutboundByCart.keys()].slice(0, MAX_CARTS);
  if (cartIds.length === 0) {
    return { scanned: 0, confirmed: 0, skipped: 0, errors: 0 };
  }

  const { data: cartRows, error: cErr } = await admin
    .from("carts")
    .select("id,user_id,member_receipt_confirmed_at")
    .in("id", cartIds)
    .in("status", ["confirmed", "archived"])
    .is("deleted_at", null)
    .is("member_receipt_confirmed_at", null);

  if (cErr) throw new Error(cErr.message);

  let confirmed = 0;
  let skipped = 0;
  let errors = 0;

  for (const cart of (cartRows ?? []) as CartRow[]) {
    const outbound = latestOutboundByCart.get(cart.id);
    if (!outbound?.status || !outbound.updated_at) {
      skipped++;
      continue;
    }
    const shipment = memberReceiptAnchorFromOutboundShipment({
      status: outbound.status,
      updated_at: outbound.updated_at,
      delivered_at: outbound.delivered_at,
    });
    if (!shipment) {
      skipped++;
      continue;
    }
    if (!isMemberReceiptAutoConfirmDue(shipment, cart.member_receipt_confirmed_at, nowMs)) {
      skipped++;
      continue;
    }

    const persisted = await ensureMemberReceiptAutoConfirmed(admin, {
      cartId: cart.id,
      userId: cart.user_id,
      memberReceiptConfirmedAt: cart.member_receipt_confirmed_at,
      shipment,
      nowMs,
    });

    if (persisted) {
      trackOrderReceivedServer(cart.user_id, cart.id, { confirm_source: "auto" });
      confirmed++;
    } else {
      errors++;
    }
  }

  return {
    scanned: (cartRows ?? []).length,
    confirmed,
    skipped,
    errors,
  };
}
