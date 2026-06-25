import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { fetchCartBorrowExtensionDaysByCartIds } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { resolveCartBorrowReturnDueMs } from "@/lib/cart/cart-borrow-return-due";
import {
  isBorrowReturnDueJjDayParis,
  isBorrowReturnOverdueParis,
} from "@/lib/cart/borrow-return-calendar";
import { borrowOverdueLateDayIndex, borrowOverdueRateBps } from "@/lib/emprunt/borrow-overdue-penalty";
import { resolveOutboundBorrowDeliveredAtIso, type SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import { resolveMembershipLabelForServiceRole } from "@/lib/user/resolve-membership-label";

export type MemberBorrowReturnOverdueAlert = {
  cartId: string;
  orderNumberCompact: string;
  dueAtIso: string;
  retourHref: string;
  lateDayIndex: number;
  ratePercent: number;
};

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Paniers en retard (après `borrow_return_due_at`, calendrier Paris), aller livré, retour non déposé.
 */
export async function fetchMemberBorrowReturnOverdueAlerts(
  service: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<MemberBorrowReturnOverdueAlert[]> {
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

  const latestReturnByCart = new Map<string, string>();
  for (const row of (retRows ?? []) as { cart_id?: string; status?: string; updated_at?: string }[]) {
    const cid = typeof row.cart_id === "string" ? row.cart_id : "";
    const st = typeof row.status === "string" ? row.status : "";
    if (!cid || !st) continue;
    latestReturnByCart.set(cid, st);
  }

  const alerts: MemberBorrowReturnOverdueAlert[] = [];

  for (const cart of cartRows) {
    const cartId = cart.id;
    const outboundAnchor = latestDeliveredAtByCart.get(cartId);
    if (!outboundAnchor) continue;

    const returnStatus = latestReturnByCart.get(cartId);
    if (returnStatus && isCartReturnCommitmentMet(returnStatus)) continue;

    const deadlineMs = resolveCartBorrowReturnDueMs({
      borrowReturnDueAtIso: cart.borrow_return_due_at,
      outboundDeliveredAtIso: outboundAnchor,
      membershipLabel: membership,
      borrowExtensionDaysTotal: extensionDaysByCartId.get(cartId) ?? 0,
    });

    if (!Number.isFinite(deadlineMs) || !isBorrowReturnOverdueParis(nowMs, deadlineMs)) continue;
    if (isBorrowReturnDueJjDayParis(nowMs, deadlineMs)) continue;

    const lateDayIndex = borrowOverdueLateDayIndex(nowMs, deadlineMs);
    if (lateDayIndex < 1) continue;

    alerts.push({
      cartId,
      orderNumberCompact: formatOrderNumberCompact(cartId),
      dueAtIso: new Date(deadlineMs).toISOString(),
      retourHref: `/exchange/retour/${cartId}`,
      lateDayIndex,
      ratePercent: Math.round(borrowOverdueRateBps(lateDayIndex) / 100),
    });
  }

  return alerts.sort((a, b) => b.lateDayIndex - a.lateDayIndex || a.cartId.localeCompare(b.cartId));
}
