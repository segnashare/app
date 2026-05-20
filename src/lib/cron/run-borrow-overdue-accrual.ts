import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureCartBorrowReturnDueAt } from "@/lib/cart/ensure-cart-borrow-return-due-at";
import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { fetchCartBorrowExtensionDaysByCartIds } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { isBorrowReturnOverdueParis } from "@/lib/cart/borrow-return-calendar";
import {
  borrowOverdueLateDayIndex,
  parisCalendarDateString,
  type BorrowOverdueAccrueResult,
} from "@/lib/emprunt/borrow-overdue-penalty";
import { resolveOutboundBorrowDeliveredAtIso } from "@/lib/emprunt/borrow-period";
import { notifyBorrowOverdueDaily } from "@/lib/notifications/lifecycle-shipment-notify";
import { settleCartBorrowOverdueStripe } from "@/lib/cart/settle-borrow-overdue-stripe";

const MAX_CARTS = 400;
const OUTBOUND_FETCH_MULT = 3;

type CartRow = {
  id: string;
  user_id: string;
  status: string;
  borrow_return_due_at: string | null;
};

/**
 * Journalise les pénalités de retard (1 jour Paris = 1 RPC `accrue_cart_borrow_overdue_day`).
 * Référence : `carts.borrow_return_due_at` (date de retour), pas la date de réception.
 */
export async function runBorrowOverdueAccrual(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{
  scanned: number;
  accrued: number;
  notified: number;
  stripeCharged: number;
  skipped: number;
  errors: number;
}> {
  const calendarDate = parisCalendarDateString(nowMs);

  const { data: outboundRows, error: oErr } = await admin
    .from("shipments")
    .select("cart_id,updated_at,delivered_at")
    .eq("context", "cart_outbound")
    .eq("status", "delivered")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_CARTS * OUTBOUND_FETCH_MULT);

  if (oErr) throw new Error(oErr.message);

  const latestDeliveredAtByCart = new Map<string, { delivered_at: string | null; updated_at: string }>();
  for (const row of (outboundRows ?? []) as {
    cart_id?: string;
    updated_at?: string;
    delivered_at?: string | null;
  }[]) {
    const cid = typeof row.cart_id === "string" ? row.cart_id : "";
    const anchor = resolveOutboundBorrowDeliveredAtIso(row.delivered_at, row.updated_at);
    if (!cid || !anchor) continue;
    const prev = latestDeliveredAtByCart.get(cid);
    if (!prev || new Date(anchor) > new Date(prev.updated_at)) {
      latestDeliveredAtByCart.set(cid, {
        delivered_at: row.delivered_at ?? null,
        updated_at: anchor,
      });
    }
  }

  const cartIds = [...latestDeliveredAtByCart.keys()].slice(0, MAX_CARTS);
  if (cartIds.length === 0) {
    return { scanned: 0, accrued: 0, notified: 0, stripeCharged: 0, skipped: 0, errors: 0 };
  }

  const { data: cartRows, error: cErr } = await admin
    .from("carts")
    .select("id,user_id,status,borrow_return_due_at")
    .in("id", cartIds)
    .in("status", ["confirmed", "archived"])
    .is("deleted_at", null);

  if (cErr) throw new Error(cErr.message);

  const carts = (cartRows ?? []) as CartRow[];
  const extensionDaysByCartId = await fetchCartBorrowExtensionDaysByCartIds(admin, cartIds);

  const { data: retRows } = await admin
    .from("shipments")
    .select("cart_id,status,updated_at")
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .in("cart_id", cartIds);

  const latestReturnByCart = new Map<string, string>();
  for (const row of (retRows ?? []) as { cart_id?: string; status?: string; updated_at?: string }[]) {
    const cid = row.cart_id ?? "";
    const st = row.status ?? "";
    const ut = row.updated_at ?? "";
    if (!cid) continue;
    const prev = latestReturnByCart.get(cid);
    if (!prev || new Date(ut) > new Date(prev)) {
      latestReturnByCart.set(cid, st);
    }
  }

  let scanned = 0;
  let accrued = 0;
  let notified = 0;
  let stripeCharged = 0;
  let skipped = 0;
  let errors = 0;

  for (const cart of carts) {
    scanned++;
    const outbound = latestDeliveredAtByCart.get(cart.id);
    if (!outbound) {
      skipped++;
      continue;
    }

    const retStatus = latestReturnByCart.get(cart.id);
    if (retStatus && isCartReturnCommitmentMet(retStatus)) {
      skipped++;
      continue;
    }

    const dueMs = await ensureCartBorrowReturnDueAt(admin, {
      cartId: cart.id,
      userId: cart.user_id,
      borrowReturnDueAtIso: cart.borrow_return_due_at,
      outboundDeliveredAtIso: outbound.delivered_at,
      outboundUpdatedAtIso: outbound.updated_at,
      borrowExtensionDaysTotal: extensionDaysByCartId.get(cart.id) ?? 0,
    });

    if (!Number.isFinite(dueMs) || !isBorrowReturnOverdueParis(nowMs, dueMs)) {
      skipped++;
      continue;
    }

    const lateDay = borrowOverdueLateDayIndex(nowMs, dueMs);
    if (lateDay < 1) {
      skipped++;
      continue;
    }

    const { data, error } = await admin.rpc("accrue_cart_borrow_overdue_day", {
      p_cart_id: cart.id,
      p_calendar_date: calendarDate,
      p_force_notify: true,
    });

    if (error) {
      console.error("[borrow-overdue] accrue", cart.id, error.message);
      errors++;
      continue;
    }

    const row = data as BorrowOverdueAccrueResult | null;
    if (row?.applied === true && !row.duplicate) {
      accrued++;
    }

    const stripe = await settleCartBorrowOverdueStripe(admin, {
      userId: cart.user_id,
      cartId: cart.id,
    });
    if (stripe.charged) {
      stripeCharged++;
    }

    if (row?.applied === true && !row.duplicate) {
      let chargeStatus = row.charge_status ?? "pending";
      let chargedViaStripe = stripe.charged;

      if (stripe.charged) {
        chargeStatus = "charged";
      } else if (chargeStatus === "pending" && stripe.error === "amount_below_stripe_minimum") {
        chargeStatus = "pending";
      } else if (stripe.error && stripe.error !== "stripe_charge_disabled" && stripe.error !== "nothing_to_settle") {
        chargeStatus = "failed";
      }

      if (row.late_day != null && row.penalty_cents != null && row.rate_bps != null && chargeStatus) {
        try {
          await notifyBorrowOverdueDaily(admin, {
            userId: cart.user_id,
            cartId: cart.id,
            lateDayIndex: row.late_day,
            penaltyCents: row.penalty_cents,
            penaltyCredits: row.penalty_credits ?? 0,
            rateBps: row.rate_bps,
            chargeStatus,
            calendarDate,
            chargedViaStripe,
          });
          notified++;
        } catch (e) {
          console.error("[borrow-overdue] notify", cart.id, e);
        }
      }
    } else {
      skipped++;
    }
  }

  return { scanned, accrued, notified, stripeCharged, skipped, errors };
}
