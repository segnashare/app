import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { notifyBorrowNonRestitutionInvoiced } from "@/lib/notifications/borrow-non-restitution-notify";
import {
  fetchBorrowOverdueUnpaidDays,
  markBorrowOverdueUnpaidDaysOnNonRestitutionInvoice,
  sumBorrowOverdueUnpaidCents,
} from "@/lib/stripe/borrow-overdue-checkout";
import { createBorrowNonRestitutionStripeInvoice } from "@/lib/stripe/borrow-non-restitution-invoice";

type OverdueRow = {
  id: string;
  cart_id: string;
  user_id: string;
  cart_value_cents: number | null;
  formal_notice_sent_at: string | null;
  formal_notice_deadline_at: string | null;
  recovery_phase: string | null;
  status: string;
  non_restitution_invoice_id: string | null;
};

async function loadReturnStatus(admin: SupabaseClient, cartId: string): Promise<string | null> {
  const { data: rows } = await admin
    .from("shipments")
    .select("status")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  return (rows?.[0] as { status?: string } | undefined)?.status ?? null;
}

export type SendBorrowNonRestitutionInvoiceResult =
  | {
      ok: true;
      cartId: string;
      overdueId: string;
      chargeId: string;
      stripeInvoiceId: string;
      hostedInvoiceUrl: string | null;
      dryRun: boolean;
    }
  | { ok: false; cartId: string; reason: string };

function isDryRunNonRestitutionInvoiceId(invoiceId: string | null | undefined): boolean {
  return String(invoiceId ?? "").trim().startsWith("dry_run_");
}

/** Dev : efface une facture dry-run pour relancer un test Stripe réel. */
export async function resetBorrowNonRestitutionDryRunForCart(
  admin: SupabaseClient,
  cartId: string,
): Promise<{ reset: boolean; reason?: string }> {
  const { data: overdue } = await admin
    .from("cart_borrow_overdue")
    .select("id")
    .eq("cart_id", cartId)
    .maybeSingle();

  if (!overdue?.id) {
    return { reset: false, reason: "overdue_not_found" };
  }

  const { data: charge } = await admin
    .from("cart_borrow_non_restitution_charges")
    .select("id,stripe_invoice_id")
    .eq("overdue_id", overdue.id)
    .maybeSingle();

  if (!charge?.id) {
    return { reset: false, reason: "no_charge_row" };
  }

  if (!isDryRunNonRestitutionInvoiceId(charge.stripe_invoice_id)) {
    return { reset: false, reason: "real_stripe_invoice_exists" };
  }

  await admin.from("cart_borrow_non_restitution_charges").delete().eq("id", charge.id);
  await admin
    .from("cart_borrow_overdue")
    .update({
      recovery_phase: "formal_notice_sent",
      non_restitution_charge_cents: null,
      non_restitution_invoice_id: null,
      unpaid_penalty_cents: null,
    })
    .eq("id", overdue.id);
  await admin
    .from("notification_send_log")
    .delete()
    .eq("idempotency_key", `txn:borrow_non_restitution_invoice:${cartId}`);

  return { reset: true };
}

export async function sendBorrowNonRestitutionInvoiceForCart(
  admin: SupabaseClient,
  input: {
    cartId: string;
    nowMs?: number;
    /** Dev : ignore deadline not yet passed. */
    force?: boolean;
    dryRun?: boolean;
    /** Renvoie l’e-mail Stripe sur une facture déjà liée. */
    resendStripeEmail?: boolean;
  },
): Promise<SendBorrowNonRestitutionInvoiceResult> {
  const cartId = input.cartId.trim();
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { data: overdue, error: oErr } = await admin
    .from("cart_borrow_overdue")
    .select(
      "id,cart_id,user_id,cart_value_cents,formal_notice_sent_at,formal_notice_deadline_at,recovery_phase,status,non_restitution_invoice_id",
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

  if (!row.formal_notice_sent_at) {
    return { ok: false, cartId, reason: "formal_notice_not_sent" };
  }

  const deadlineMs = Date.parse(String(row.formal_notice_deadline_at ?? ""));
  if (!input.force && (!Number.isFinite(deadlineMs) || nowMs <= deadlineMs)) {
    return { ok: false, cartId, reason: "formal_notice_deadline_not_passed" };
  }

  if (row.recovery_phase === "non_restitution_charged") {
    return { ok: false, cartId, reason: "already_charged" };
  }

  const { data: existingCharge } = await admin
    .from("cart_borrow_non_restitution_charges")
    .select("id,stripe_invoice_id")
    .eq("overdue_id", row.id)
    .maybeSingle();

  if (existingCharge?.id) {
    return {
      ok: false,
      cartId,
      reason: `charge_row_exists:${existingCharge.stripe_invoice_id ?? "unknown"}`,
    };
  }

  const linkedInvoiceId = String(row.non_restitution_invoice_id ?? "").trim();

  const retStatus = await loadReturnStatus(admin, cartId);
  if (retStatus && isCartReturnCommitmentMet(retStatus)) {
    return { ok: false, cartId, reason: "return_commitment_met" };
  }

  const { data: user, error: uErr } = await admin
    .from("users")
    .select("email")
    .eq("id", row.user_id)
    .maybeSingle();

  if (uErr || !user?.email?.trim()) {
    return { ok: false, cartId, reason: "member_email_missing" };
  }

  const cartValueCents = Math.max(0, Math.trunc(Number(row.cart_value_cents ?? 0)));
  const orderRef = cartId.slice(0, 8).toUpperCase();

  const unpaidDays = await fetchBorrowOverdueUnpaidDays(admin, cartId);
  const unpaidPenaltyCents = sumBorrowOverdueUnpaidCents(unpaidDays);
  const unpaidDayIds = unpaidDays.map((d) => d.id);

  const invoiceResult = await createBorrowNonRestitutionStripeInvoice(admin, {
    userId: row.user_id,
    userEmail: user.email,
    cartId,
    overdueId: row.id,
    cartValueCents,
    unpaidPenaltyCents,
    orderRef,
    forceDryRun: input.dryRun === true,
    existingStripeInvoiceId: linkedInvoiceId || null,
    resendStripeEmail: input.resendStripeEmail === true,
  });

  if (!invoiceResult.ok) {
    return { ok: false, cartId, reason: invoiceResult.error };
  }

  const { data: chargeRow, error: cErr } = await admin
    .from("cart_borrow_non_restitution_charges")
    .insert({
      cart_id: cartId,
      overdue_id: row.id,
      amount_cents: invoiceResult.cartValueCents,
      unpaid_penalty_cents: invoiceResult.unpaidPenaltyCents,
      stripe_invoice_id: invoiceResult.invoiceId,
      stripe_invoice_hosted_url: invoiceResult.hostedInvoiceUrl,
      status: "pending",
      attempt_number: 1,
    })
    .select("id")
    .single();

  if (cErr || !chargeRow?.id) {
    return { ok: false, cartId, reason: cErr?.message ?? "charge_insert_failed" };
  }

  const { error: updErr } = await admin
    .from("cart_borrow_overdue")
    .update({
      recovery_phase: "non_restitution_due",
      non_restitution_charge_cents: invoiceResult.totalCents,
      unpaid_penalty_cents: invoiceResult.unpaidPenaltyCents,
      non_restitution_invoice_id: invoiceResult.invoiceId,
      updated_at: nowIso,
    })
    .eq("id", row.id);

  if (updErr) {
    return { ok: false, cartId, reason: updErr.message };
  }

  if (!invoiceResult.dryRun && unpaidDayIds.length > 0) {
    try {
      await markBorrowOverdueUnpaidDaysOnNonRestitutionInvoice(
        admin,
        unpaidDayIds,
        invoiceResult.invoiceId,
      );
    } catch (e) {
      console.error("[borrow-non-restitution] mark unpaid days invoiced", cartId, e);
    }
  }

  try {
    await notifyBorrowNonRestitutionInvoiced(admin, {
      userId: row.user_id,
      cartId,
      orderRef,
      cartValueCents: invoiceResult.cartValueCents,
      unpaidPenaltyCents: invoiceResult.unpaidPenaltyCents,
      totalCents: invoiceResult.totalCents,
      hostedInvoiceUrl: invoiceResult.hostedInvoiceUrl,
      cronSmsNowMs: nowMs,
    });
  } catch (e) {
    console.error("[borrow-non-restitution] notify failed", cartId, e);
  }

  return {
    ok: true,
    cartId,
    overdueId: row.id,
    chargeId: String(chargeRow.id),
    stripeInvoiceId: invoiceResult.invoiceId,
    hostedInvoiceUrl: invoiceResult.hostedInvoiceUrl,
    dryRun: invoiceResult.dryRun,
  };
}
