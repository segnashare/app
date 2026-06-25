import type { SupabaseClient } from "@supabase/supabase-js";

import { sendBorrowFormalNoticeForCart } from "@/lib/borrow-formal-notice/send-borrow-formal-notice";
import { ensureCartBorrowReturnDueAt } from "@/lib/cart/ensure-cart-borrow-return-due-at";
import { fetchCartBorrowExtensionDaysByCartIds } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { isBorrowReturnOverdueParis } from "@/lib/cart/borrow-return-calendar";
import { BORROW_FORMAL_NOTICE_DAY } from "@/lib/emprunt/borrow-overdue-recovery-policy";
import { borrowOverdueLateDayIndex } from "@/lib/emprunt/borrow-overdue-penalty";
import { resolveOutboundBorrowDeliveredAtIso } from "@/lib/emprunt/borrow-period";
import { getAr24Config } from "@/lib/ar24/send-formal-notice";

const MAX_OVERDUE = 200;

type OverdueRow = {
  id: string;
  cart_id: string;
  user_id: string;
};

type CartRow = {
  id: string;
  user_id: string;
  borrow_return_due_at: string | null;
};

/**
 * Cron J+21 : envoi mise en demeure AR24 pour dossiers retard sans MED.
 */
export async function runBorrowFormalNotice(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  reasons: Record<string, number>;
}> {
  const ar24 = getAr24Config();
  if (!ar24) {
    return {
      scanned: 0,
      sent: 0,
      skipped: 0,
      errors: 1,
      reasons: { ar24_not_configured: 1 },
    };
  }

  const { data: overdueRows, error } = await admin
    .from("cart_borrow_overdue")
    .select("id,cart_id,user_id")
    .in("status", ["active", "escalated"])
    .is("formal_notice_sent_at", null)
    .order("updated_at", { ascending: true })
    .limit(MAX_OVERDUE);

  if (error) throw new Error(error.message);

  const rows = (overdueRows ?? []) as OverdueRow[];
  if (rows.length === 0) {
    return { scanned: 0, sent: 0, skipped: 0, errors: 0, reasons: {} };
  }

  const cartIds = [...new Set(rows.map((r) => r.cart_id))];
  const { data: cartRows, error: cErr } = await admin
    .from("carts")
    .select("id,user_id,borrow_return_due_at")
    .in("id", cartIds)
    .in("status", ["confirmed", "archived", "disputed"])
    .is("deleted_at", null);

  if (cErr) throw new Error(cErr.message);

  const cartsById = new Map<string, CartRow>();
  for (const c of (cartRows ?? []) as CartRow[]) {
    cartsById.set(c.id, c);
  }

  const extensionDaysByCartId = await fetchCartBorrowExtensionDaysByCartIds(admin, cartIds);

  const { data: outboundRows } = await admin
    .from("shipments")
    .select("cart_id,delivered_at,updated_at")
    .eq("context", "cart_outbound")
    .eq("status", "delivered")
    .is("deleted_at", null)
    .in("cart_id", cartIds);

  const outboundByCart = new Map<string, { delivered_at: string | null; updated_at: string }>();
  for (const row of (outboundRows ?? []) as {
    cart_id?: string;
    delivered_at?: string | null;
    updated_at?: string;
  }[]) {
    const cid = row.cart_id ?? "";
    if (!cid) continue;
    const anchor = resolveOutboundBorrowDeliveredAtIso(row.delivered_at, row.updated_at);
    if (!anchor) continue;
    const prev = outboundByCart.get(cid);
    if (!prev || new Date(anchor) > new Date(prev.updated_at)) {
      outboundByCart.set(cid, { delivered_at: row.delivered_at ?? null, updated_at: anchor });
    }
  }

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
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const reasons: Record<string, number> = {};

  const bump = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  for (const overdue of rows) {
    scanned++;
    const cart = cartsById.get(overdue.cart_id);
    if (!cart) {
      skipped++;
      bump("cart_ineligible");
      continue;
    }

    const retStatus = latestReturnByCart.get(overdue.cart_id);
    if (retStatus && isCartReturnCommitmentMet(retStatus)) {
      skipped++;
      bump("return_commitment_met");
      continue;
    }

    const outbound = outboundByCart.get(overdue.cart_id);
    if (!outbound) {
      skipped++;
      bump("outbound_not_delivered");
      continue;
    }

    const dueMs = await ensureCartBorrowReturnDueAt(admin, {
      cartId: overdue.cart_id,
      userId: cart.user_id,
      borrowReturnDueAtIso: cart.borrow_return_due_at,
      outboundDeliveredAtIso: outbound.delivered_at,
      outboundUpdatedAtIso: outbound.updated_at,
      borrowExtensionDaysTotal: extensionDaysByCartId.get(overdue.cart_id) ?? 0,
    });

    if (!Number.isFinite(dueMs) || !isBorrowReturnOverdueParis(nowMs, dueMs)) {
      skipped++;
      bump("not_overdue");
      continue;
    }

    const lateDay = borrowOverdueLateDayIndex(nowMs, dueMs);
    if (lateDay < BORROW_FORMAL_NOTICE_DAY) {
      skipped++;
      bump(`late_day_${lateDay}`);
      continue;
    }

    const result = await sendBorrowFormalNoticeForCart(admin, {
      cartId: overdue.cart_id,
      nowMs,
    });

    if (result.ok) {
      sent++;
    } else {
      if (
        result.reason === "already_sent" ||
        result.reason === "notice_row_exists" ||
        result.reason.startsWith("late_day_")
      ) {
        skipped++;
      } else {
        errors++;
        console.error("[borrow-formal-notice] cron", overdue.cart_id, result.reason);
      }
      bump(result.reason);
    }
  }

  return { scanned, sent, skipped, errors, reasons };
}
