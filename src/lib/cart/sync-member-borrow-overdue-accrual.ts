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
import { settleCartBorrowOverdueStripe } from "@/lib/cart/settle-borrow-overdue-stripe";

/**
 * Journalise le jour de retard en base (`cart_borrow_overdue*`) pour les paniers du membre.
 * Idempotent : 1 ligne / jour Paris. Appelé à l’ouverture de la page Échange (service role).
 */
export async function syncMemberBorrowOverdueAccrual(
  admin: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<{ accrued: number; stripeCharged: number; errors: number }> {
  const calendarDate = parisCalendarDateString(nowMs);

  const { data: carts, error: cErr } = await admin
    .from("carts")
    .select("id,user_id,status,borrow_return_due_at")
    .eq("user_id", userId)
    .in("status", ["confirmed", "archived"])
    .is("deleted_at", null);

  if (cErr || !carts?.length) return { accrued: 0, stripeCharged: 0, errors: 0 };

  const cartRows = carts as {
    id: string;
    user_id: string;
    borrow_return_due_at?: string | null;
  }[];
  const cartIds = cartRows.map((c) => c.id);

  const { data: outboundRows } = await admin
    .from("shipments")
    .select("cart_id,delivered_at,updated_at")
    .in("cart_id", cartIds)
    .eq("context", "cart_outbound")
    .eq("status", "delivered")
    .is("deleted_at", null);

  const latestOutboundByCart = new Map<string, { delivered_at: string | null; updated_at: string }>();
  for (const row of (outboundRows ?? []) as {
    cart_id?: string;
    delivered_at?: string | null;
    updated_at?: string;
  }[]) {
    const cid = row.cart_id ?? "";
    const anchor = resolveOutboundBorrowDeliveredAtIso(row.delivered_at, row.updated_at);
    if (!cid || !anchor) continue;
    const prev = latestOutboundByCart.get(cid);
    if (!prev || new Date(anchor) > new Date(prev.updated_at)) {
      latestOutboundByCart.set(cid, {
        delivered_at: row.delivered_at ?? null,
        updated_at: anchor,
      });
    }
  }

  const { data: retRows } = await admin
    .from("shipments")
    .select("cart_id,status,updated_at")
    .in("cart_id", cartIds)
    .eq("context", "cart_return")
    .is("deleted_at", null);

  const latestReturnByCart = new Map<string, string>();
  for (const row of (retRows ?? []) as { cart_id?: string; status?: string }[]) {
    const cid = row.cart_id ?? "";
    const st = row.status ?? "";
    if (cid && st) latestReturnByCart.set(cid, st);
  }

  const extensionDaysByCartId = await fetchCartBorrowExtensionDaysByCartIds(admin, cartIds);

  let accrued = 0;
  let stripeCharged = 0;
  let errors = 0;

  for (const cart of cartRows) {
    const outbound = latestOutboundByCart.get(cart.id);
    if (!outbound) continue;

    const retStatus = latestReturnByCart.get(cart.id);
    if (retStatus && isCartReturnCommitmentMet(retStatus)) continue;

    const dueMs = await ensureCartBorrowReturnDueAt(admin, {
      cartId: cart.id,
      userId: cart.user_id,
      borrowReturnDueAtIso: cart.borrow_return_due_at,
      outboundDeliveredAtIso: outbound.delivered_at,
      outboundUpdatedAtIso: outbound.updated_at,
      borrowExtensionDaysTotal: extensionDaysByCartId.get(cart.id) ?? 0,
    });

    if (!Number.isFinite(dueMs) || !isBorrowReturnOverdueParis(nowMs, dueMs)) continue;
    if (borrowOverdueLateDayIndex(nowMs, dueMs) < 1) continue;

    const { data, error } = await admin.rpc("accrue_cart_borrow_overdue_day", {
      p_cart_id: cart.id,
      p_calendar_date: calendarDate,
      p_force_notify: false,
    });

    if (error) {
      console.error("[borrow-overdue] sync member", cart.id, error.message);
      errors++;
      continue;
    }

    const row = data as BorrowOverdueAccrueResult | null;
    if (row?.ok === false && row.error) {
      console.error("[borrow-overdue] sync member", cart.id, row.error);
      errors++;
      continue;
    }
    if (row?.applied === true) {
      accrued++;
    } else if (row?.skipped) {
      console.info("[borrow-overdue] sync skip", cart.id, row.skipped);
    }

    const stripe = await settleCartBorrowOverdueStripe(admin, {
      userId: cart.user_id,
      cartId: cart.id,
    });
    if (stripe.charged) {
      stripeCharged++;
    }
  }

  return { accrued, stripeCharged, errors };
}
