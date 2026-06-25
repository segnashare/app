import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { fetchCartBorrowExtensionDaysByCartIds } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { resolveCartBorrowReturnDueMs } from "@/lib/cart/cart-borrow-return-due";
import { isBorrowReturnDueJjDay } from "@/lib/emprunt/borrow-return-reminder-buckets";
import { resolveOutboundBorrowDeliveredAtIso, type SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import { resolveMembershipLabelForServiceRole } from "@/lib/user/resolve-membership-label";

export type MemberBorrowReturnJjAlert = {
  cartId: string;
  orderNumberCompact: string;
  dueAtIso: string;
  retourHref: string;
};

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function retourHrefForCart(cartId: string): string {
  return `/exchange/retour/${cartId}`;
}

/**
 * Paniers en J-J (jour calendaire de l’échéance, Paris) avec aller livré et retour non encore déposé.
 * Ne dépend pas de l’existence préalable d’une expédition `cart_return`.
 */
export async function fetchMemberBorrowReturnJjAlerts(
  service: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<MemberBorrowReturnJjAlert[]> {
  const { data: carts, error: cErr } = await service
    .from("carts")
    .select("id,status,borrow_return_due_at")
    .eq("user_id", userId)
    .in("status", ["confirmed", "archived", "disputed"])
    .is("deleted_at", null);

  if (cErr || !carts?.length) return [];

  const cartRows = carts as { id: string; status: string; borrow_return_due_at?: string | null }[];
  const cartIds = cartRows.map((c) => c.id).filter(Boolean);
  if (cartIds.length === 0) return [];

  const membership = (await resolveMembershipLabelForServiceRole(service, userId)) as SegnaBorrowMembershipLabel;
  const extensionDaysByCartId = await fetchCartBorrowExtensionDaysByCartIds(service, cartIds);

  const { data: outboundRows } = await service
    .from("shipments")
    .select("cart_id,updated_at,delivered_at")
    .in("cart_id", cartIds)
    .eq("context", "cart_outbound")
    .eq("status", "delivered")
    .is("deleted_at", null);

  const latestDeliveredAtByCart = new Map<string, string>();
  for (const row of (outboundRows ?? []) as {
    cart_id?: string;
    updated_at?: string;
    delivered_at?: string | null;
  }[]) {
    const cid = typeof row.cart_id === "string" ? row.cart_id : "";
    const anchor = resolveOutboundBorrowDeliveredAtIso(row.delivered_at, row.updated_at);
    if (!cid || !anchor) continue;
    const prev = latestDeliveredAtByCart.get(cid);
    if (!prev || new Date(anchor) > new Date(prev)) {
      latestDeliveredAtByCart.set(cid, anchor);
    }
  }

  const { data: retRows } = await service
    .from("shipments")
    .select("cart_id,status,updated_at")
    .in("cart_id", cartIds)
    .eq("context", "cart_return")
    .is("deleted_at", null);

  const latestReturnByCart = new Map<string, { status: string; updated_at: string }>();
  for (const row of (retRows ?? []) as { cart_id?: string; status?: string; updated_at?: string }[]) {
    const cid = typeof row.cart_id === "string" ? row.cart_id : "";
    const st = typeof row.status === "string" ? row.status : "";
    const ut = typeof row.updated_at === "string" ? row.updated_at : "";
    if (!cid || !st || !ut) continue;
    const prev = latestReturnByCart.get(cid);
    if (!prev || new Date(ut) > new Date(prev.updated_at)) {
      latestReturnByCart.set(cid, { status: st, updated_at: ut });
    }
  }

  const alerts: MemberBorrowReturnJjAlert[] = [];

  for (const cart of cartRows) {
    const cartId = cart.id;
    const outboundAnchor = latestDeliveredAtByCart.get(cartId);
    if (!outboundAnchor) continue;

    const returnStatus = latestReturnByCart.get(cartId)?.status;
    if (returnStatus && isCartReturnCommitmentMet(returnStatus)) continue;

    const deadlineMs = resolveCartBorrowReturnDueMs({
      borrowReturnDueAtIso: cart.borrow_return_due_at,
      outboundDeliveredAtIso: outboundAnchor,
      membershipLabel: membership,
      borrowExtensionDaysTotal: extensionDaysByCartId.get(cartId) ?? 0,
    });
    if (!isBorrowReturnDueJjDay(nowMs, deadlineMs)) continue;

    alerts.push({
      cartId,
      orderNumberCompact: formatOrderNumberCompact(cartId),
      dueAtIso: new Date(deadlineMs).toISOString(),
      retourHref: retourHrefForCart(cartId),
    });
  }

  return alerts.sort((a, b) => a.cartId.localeCompare(b.cartId));
}
