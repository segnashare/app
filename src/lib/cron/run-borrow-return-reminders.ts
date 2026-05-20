import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { fetchCartBorrowExtensionDaysByCartIds } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { resolveCartBorrowReturnDueMs } from "@/lib/cart/cart-borrow-return-due";
import { resolveOutboundBorrowDeliveredAtIso, type SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import { pickBorrowReturnReminder } from "@/lib/emprunt/borrow-return-reminder-buckets";
import { notifyBorrowDeadlineReminder } from "@/lib/notifications/lifecycle-shipment-notify";
import { resolveMembershipLabelForServiceRole } from "@/lib/user/resolve-membership-label";

const MAX_CARTS = 400;
const OUTBOUND_FETCH_MULT = 3;

type CartRow = { id: string; user_id: string; status: string; borrow_return_due_at?: string | null };

/**
 * Rappels avant échéance (Guest J-3 / J-1 / J-J ; Membre + / X : J-7 / J-3 / J-J).
 * Les retards J+1+ sont notifiés par `runBorrowOverdueAccrual` (`borrow_overdue_daily`).
 */
export async function runBorrowReturnReminders(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{ scanned: number; eligible: number; notifyCalls: number }> {
  const { data: outboundRows, error: oErr } = await admin
    .from("shipments")
    .select("cart_id,updated_at,delivered_at")
    .eq("context", "cart_outbound")
    .eq("status", "delivered")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_CARTS * OUTBOUND_FETCH_MULT);

  if (oErr) {
    throw new Error(oErr.message);
  }

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

  const cartIds = [...latestDeliveredAtByCart.keys()].slice(0, MAX_CARTS);

  const { data: carts, error: cErr } = await admin
    .from("carts")
    .select("id,user_id,status,borrow_return_due_at")
    .in("id", cartIds);
  if (cErr) {
    throw new Error(cErr.message);
  }

  const cartById = new Map<string, CartRow>();
  for (const row of (carts ?? []) as CartRow[]) {
    if (row?.id) cartById.set(row.id, row);
  }

  const extensionDaysByCartId = await fetchCartBorrowExtensionDaysByCartIds(admin, cartIds);

  const { data: retRows, error: rErr } = await admin
    .from("shipments")
    .select("cart_id,status,updated_at")
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .in("cart_id", cartIds);

  if (rErr) {
    throw new Error(rErr.message);
  }

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

  let scanned = 0;
  let eligible = 0;
  let notifyCalls = 0;

  for (const cartId of cartIds) {
    scanned++;
    const cart = cartById.get(cartId);
    if (!cart || (cart.status !== "confirmed" && cart.status !== "archived")) continue;

    const outboundAnchor = latestDeliveredAtByCart.get(cartId);
    if (!outboundAnchor) continue;

    const ret = latestReturnByCart.get(cartId);
    if (ret && isCartReturnCommitmentMet(ret.status)) continue;

    const membership = await resolveMembershipLabelForServiceRole(admin, cart.user_id);
    const membershipLabel = membership as SegnaBorrowMembershipLabel;
    const deadlineMs = resolveCartBorrowReturnDueMs({
      borrowReturnDueAtIso: cart.borrow_return_due_at,
      outboundDeliveredAtIso: outboundAnchor,
      membershipLabel,
      borrowExtensionDaysTotal: extensionDaysByCartId.get(cartId) ?? 0,
    });
    if (!Number.isFinite(deadlineMs)) continue;

    const pick = pickBorrowReturnReminder(nowMs, deadlineMs, membershipLabel);
    if (!pick) continue;
    eligible++;

    await notifyBorrowDeadlineReminder(admin, {
      userId: cart.user_id,
      cartId,
      phase: pick.phase,
      idempotencyBucket: pick.idempotencyBucket,
      templateDaysLeft: pick.templateDaysLeft,
    });
    notifyCalls++;
  }

  return { scanned, eligible, notifyCalls };
}
