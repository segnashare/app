import {
  ensureMemberReceiptAutoConfirmed,
  isMemberReceiptValidated,
  memberReceiptAnchorFromOutboundShipment,
  resolveMemberReceiptDeliveredAnchorIso,
} from "@/lib/cart/member-receipt-validation";
import { resolveOutboundBorrowDeliveredAtIso } from "@/lib/emprunt/borrow-period";

export type MemberReceiptPendingGatePayload = {
  cartId: string;
  orderNumberCompact: string;
};

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Première commande livrée dont la réception membre n’est pas encore validée (manuelle ou auto). */
export async function fetchMemberPendingReceiptGate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client Supabase typage projet
  supabase: any,
  userId: string,
): Promise<MemberReceiptPendingGatePayload | null> {
  const { data: cartRows, error: cartErr } = await supabase
    .from("carts")
    .select("id,member_receipt_confirmed_at,updated_at")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .is("deleted_at", null)
    .is("member_receipt_confirmed_at", null)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (cartErr || !Array.isArray(cartRows) || cartRows.length === 0) {
    return null;
  }

  const cartIds = (cartRows as { id?: string }[])
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean);
  if (cartIds.length === 0) return null;

  const { data: shipRows, error: shipErr } = await supabase
    .from("shipments")
    .select("cart_id,status,updated_at,delivered_at")
    .in("cart_id", cartIds)
    .eq("context", "cart_outbound")
    .is("deleted_at", null);

  if (shipErr || !Array.isArray(shipRows)) {
    return null;
  }

  const outboundByCartId = new Map<
    string,
    { status: string; updated_at: string; delivered_at: string | null }
  >();
  for (const row of shipRows as {
    cart_id?: string;
    status?: string;
    updated_at?: string;
    delivered_at?: string | null;
  }[]) {
    const cartId = typeof row.cart_id === "string" ? row.cart_id : "";
    if (!cartId || typeof row.status !== "string" || typeof row.updated_at !== "string") continue;
    const prev = outboundByCartId.get(cartId);
    const anchorMs = Date.parse(
      resolveOutboundBorrowDeliveredAtIso(row.delivered_at ?? null, row.updated_at) ?? "",
    );
    const prevAnchorMs = prev
      ? Date.parse(
          resolveOutboundBorrowDeliveredAtIso(prev.delivered_at, prev.updated_at) ?? "",
        )
      : Number.NaN;
    if (!prev || (!Number.isNaN(anchorMs) && (Number.isNaN(prevAnchorMs) || anchorMs > prevAnchorMs))) {
      outboundByCartId.set(cartId, {
        status: row.status,
        updated_at: row.updated_at,
        delivered_at: row.delivered_at ?? null,
      });
    }
  }

  type PendingCandidate = { cartId: string; deliveredMs: number };
  const pending: PendingCandidate[] = [];

  for (const cart of cartRows as {
    id?: string;
    member_receipt_confirmed_at?: string | null;
  }[]) {
    const cartId = typeof cart.id === "string" ? cart.id : "";
    if (!cartId) continue;

    const ship = outboundByCartId.get(cartId);
    if (!ship || ship.status.trim().toLowerCase() !== "delivered") continue;

    const receiptAnchor = memberReceiptAnchorFromOutboundShipment(ship);
    if (!receiptAnchor) continue;

    const confirmedAt = await ensureMemberReceiptAutoConfirmed(supabase, {
      cartId,
      userId,
      memberReceiptConfirmedAt: cart.member_receipt_confirmed_at,
      shipment: receiptAnchor,
    });

    if (
      isMemberReceiptValidated(
        confirmedAt ?? cart.member_receipt_confirmed_at,
        receiptAnchor,
      )
    ) {
      continue;
    }

    const deliveredIso = resolveMemberReceiptDeliveredAnchorIso(receiptAnchor);
    const deliveredMs = deliveredIso ? Date.parse(deliveredIso) : Number.NaN;
    pending.push({
      cartId,
      deliveredMs: Number.isFinite(deliveredMs) ? deliveredMs : 0,
    });
  }

  if (pending.length === 0) return null;

  pending.sort((a, b) => b.deliveredMs - a.deliveredMs);
  const cartId = pending[0]!.cartId;
  return {
    cartId,
    orderNumberCompact: formatOrderNumberCompact(cartId),
  };
}

export function isMemberReceiptCommandeFlowPath(pathname: string, cartId: string): boolean {
  const base = `/commande/${cartId}`;
  return pathname === base || pathname.startsWith(`${base}/`);
}
