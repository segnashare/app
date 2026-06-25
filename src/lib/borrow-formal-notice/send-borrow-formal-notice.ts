import type { SupabaseClient } from "@supabase/supabase-js";

import { ar24SendRegisteredMail, getAr24Config } from "@/lib/ar24/send-formal-notice";
import {
  BORROW_FORMAL_NOTICE_TEMPLATE_VERSION,
  buildBorrowFormalNoticeHtml,
} from "@/lib/borrow-formal-notice/build-formal-notice-content";
import { ensureCartBorrowReturnDueAt } from "@/lib/cart/ensure-cart-borrow-return-due-at";
import { fetchCartBorrowExtensionDaysByCartIds } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { isBorrowReturnOverdueParis } from "@/lib/cart/borrow-return-calendar";
import {
  BORROW_FORMAL_NOTICE_DAY,
  borrowFormalNoticeDeadlineIso,
} from "@/lib/emprunt/borrow-overdue-recovery-policy";
import { borrowOverdueLateDayIndex } from "@/lib/emprunt/borrow-overdue-penalty";
import { resolveOutboundBorrowDeliveredAtIso } from "@/lib/emprunt/borrow-period";
import { notifyBorrowFormalNoticeSent } from "@/lib/notifications/borrow-formal-notice-notify";

export type SendBorrowFormalNoticeResult =
  | { ok: true; cartId: string; overdueId: string; formalNoticeId: string; dryRun?: boolean }
  | { ok: false; cartId: string; reason: string };

type OverdueRow = {
  id: string;
  cart_id: string;
  user_id: string;
  status: string;
  cart_value_cents: number | null;
  penalties_accrued_cents: number | null;
  formal_notice_sent_at: string | null;
};

async function loadReturnStatus(admin: SupabaseClient, cartId: string): Promise<string | null> {
  const { data: retRows } = await admin
    .from("shipments")
    .select("status,updated_at")
    .eq("context", "cart_return")
    .eq("cart_id", cartId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  const row = (retRows ?? [])[0] as { status?: string } | undefined;
  return row?.status ?? null;
}

async function loadOutboundAnchor(
  admin: SupabaseClient,
  cartId: string,
): Promise<{ delivered_at: string | null; updated_at: string } | null> {
  const { data: rows } = await admin
    .from("shipments")
    .select("delivered_at,updated_at")
    .eq("context", "cart_outbound")
    .eq("cart_id", cartId)
    .eq("status", "delivered")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  const row = (rows ?? [])[0] as { delivered_at?: string | null; updated_at?: string } | undefined;
  if (!row?.updated_at) return null;
  const anchor = resolveOutboundBorrowDeliveredAtIso(row.delivered_at, row.updated_at);
  if (!anchor) return null;
  return { delivered_at: row.delivered_at ?? null, updated_at: anchor };
}

/** Envoie la MED AR24 pour un dossier éligible (J+21+, pas encore envoyée). */
export async function sendBorrowFormalNoticeForCart(
  admin: SupabaseClient,
  input: {
    cartId: string;
    nowMs?: number;
    /** Ignore le seuil J+21 (dev uniquement). */
    force?: boolean;
    /** Simule AR24 sans credentials (dev). */
    dryRun?: boolean;
  },
): Promise<SendBorrowFormalNoticeResult> {
  const cartId = input.cartId.trim();
  const nowMs = input.nowMs ?? Date.now();
  const sentAtIso = new Date(nowMs).toISOString();
  const deadlineAtIso = borrowFormalNoticeDeadlineIso(sentAtIso);

  const { data: overdue, error: oErr } = await admin
    .from("cart_borrow_overdue")
    .select(
      "id,cart_id,user_id,status,cart_value_cents,penalties_accrued_cents,formal_notice_sent_at",
    )
    .eq("cart_id", cartId)
    .in("status", ["active", "escalated"])
    .maybeSingle();

  if (oErr) {
    return { ok: false, cartId, reason: oErr.message };
  }
  if (!overdue) {
    return { ok: false, cartId, reason: "overdue_not_found" };
  }

  const row = overdue as OverdueRow;
  if (row.formal_notice_sent_at) {
    return { ok: false, cartId, reason: "already_sent" };
  }

  const { data: existingNotice } = await admin
    .from("cart_borrow_formal_notices")
    .select("id")
    .eq("overdue_id", row.id)
    .limit(1)
    .maybeSingle();

  if (existingNotice?.id) {
    return { ok: false, cartId, reason: "notice_row_exists" };
  }

  const { data: cart, error: cErr } = await admin
    .from("carts")
    .select("id,user_id,status,borrow_return_due_at,deleted_at")
    .eq("id", cartId)
    .maybeSingle();

  if (cErr || !cart?.user_id || cart.deleted_at) {
    return { ok: false, cartId, reason: "cart_not_found" };
  }

  const retStatus = await loadReturnStatus(admin, cartId);
  if (retStatus && isCartReturnCommitmentMet(retStatus)) {
    return { ok: false, cartId, reason: "return_commitment_met" };
  }

  const outbound = await loadOutboundAnchor(admin, cartId);
  if (!outbound) {
    return { ok: false, cartId, reason: "outbound_not_delivered" };
  }

  const extensionDays = (await fetchCartBorrowExtensionDaysByCartIds(admin, [cartId])).get(cartId) ?? 0;
  const dueMs = await ensureCartBorrowReturnDueAt(admin, {
    cartId,
    userId: String(cart.user_id),
    borrowReturnDueAtIso: cart.borrow_return_due_at,
    outboundDeliveredAtIso: outbound.delivered_at,
    outboundUpdatedAtIso: outbound.updated_at,
    borrowExtensionDaysTotal: extensionDays,
  });

  if (!Number.isFinite(dueMs) || !isBorrowReturnOverdueParis(nowMs, dueMs)) {
    return { ok: false, cartId, reason: "not_overdue" };
  }

  const lateDayIndex = borrowOverdueLateDayIndex(nowMs, dueMs);
  if (!input.force && lateDayIndex < BORROW_FORMAL_NOTICE_DAY) {
    return { ok: false, cartId, reason: `late_day_${lateDayIndex}_lt_${BORROW_FORMAL_NOTICE_DAY}` };
  }

  const { data: user, error: uErr } = await admin
    .from("users")
    .select("email,first_name,last_name")
    .eq("id", row.user_id)
    .maybeSingle();

  if (uErr || !user?.email?.trim()) {
    return { ok: false, cartId, reason: "member_email_missing" };
  }

  const ar24 = getAr24Config({ forceDryRun: input.dryRun === true });
  if (!ar24) {
    return { ok: false, cartId, reason: "ar24_not_configured" };
  }

  const orderRef = cartId.slice(0, 8).toUpperCase();
  const cartValueCents = Math.max(0, Math.trunc(Number(row.cart_value_cents ?? 0)));
  const penaltiesAccruedCents = Math.max(0, Math.trunc(Number(row.penalties_accrued_cents ?? 0)));

  const content = buildBorrowFormalNoticeHtml({
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    orderRef,
    borrowReturnDueMs: dueMs,
    lateDayIndex,
    penaltiesAccruedCents,
    cartValueCents,
    sentAtIso,
  });

  const ar24Result = await ar24SendRegisteredMail(ar24, {
    toEmail: user.email.trim(),
    toFirstname: user.first_name?.trim() || "Membre",
    toLastname: user.last_name?.trim() || "Segna",
    content,
    refDossier: `borrow-${cartId}`,
    refClient: String(row.user_id),
  });

  if (!ar24Result.ok) {
    return { ok: false, cartId, reason: ar24Result.error ?? "ar24_send_failed" };
  }

  const { data: noticeRow, error: nErr } = await admin
    .from("cart_borrow_formal_notices")
    .insert({
      cart_id: cartId,
      overdue_id: row.id,
      sent_at: sentAtIso,
      deadline_at: deadlineAtIso,
      channel: "ar24",
      template_version: BORROW_FORMAL_NOTICE_TEMPLATE_VERSION,
      member_email_snapshot: user.email.trim(),
      payload: {
        order_ref: orderRef,
        late_day_index: lateDayIndex,
        penalties_accrued_cents: penaltiesAccruedCents,
        cart_value_cents: cartValueCents,
        ar24_dry_run: ar24Result.dryRun ?? false,
      },
      ar24_message_id: ar24Result.ar24MessageId,
      ar24_proof_url: ar24Result.ar24ProofUrl,
      ar24_status: ar24Result.ar24Status,
    })
    .select("id")
    .single();

  if (nErr || !noticeRow?.id) {
    return { ok: false, cartId, reason: nErr?.message ?? "notice_insert_failed" };
  }

  const { error: updErr } = await admin
    .from("cart_borrow_overdue")
    .update({
      formal_notice_sent_at: sentAtIso,
      formal_notice_deadline_at: deadlineAtIso,
      recovery_phase: "formal_notice_sent",
      updated_at: sentAtIso,
    })
    .eq("id", row.id)
    .is("formal_notice_sent_at", null);

  if (updErr) {
    return { ok: false, cartId, reason: updErr.message };
  }

  try {
    await notifyBorrowFormalNoticeSent(admin, {
      userId: row.user_id,
      cartId,
      orderRef,
      lateDayIndex,
      deadlineAtIso,
      penaltiesAccruedCents,
      cronSmsNowMs: nowMs,
    });
  } catch (e) {
    console.error("[borrow-formal-notice] complementary notify failed", cartId, e);
  }

  return {
    ok: true,
    cartId,
    overdueId: row.id,
    formalNoticeId: String(noticeRow.id),
    dryRun: ar24Result.dryRun,
  };
}
