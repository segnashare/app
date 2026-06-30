import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { ensureCartBorrowReturnDueAt } from "@/lib/cart/ensure-cart-borrow-return-due-at";
import { fetchCartBorrowExtensionDaysByCartIds } from "@/lib/cart/fetch-cart-borrow-extension-days";
import { isBorrowReturnOverdueParis } from "@/lib/cart/borrow-return-calendar";
import {
  fetchMemberCartBorrowOverdue,
  type MemberCartBorrowOverdueDay,
} from "@/lib/cart/fetch-member-cart-borrow-overdue";
import { borrowOverdueLateDayIndex } from "@/lib/emprunt/borrow-overdue-penalty";
import { resolveBorrowNonRestitutionDeadlineMs } from "@/lib/emprunt/borrow-overdue-recovery-policy";
import { shouldBlockAppForBorrowOverdue } from "@/lib/emprunt/borrow-overdue-recovery-phase";
import { resolveOutboundBorrowDeliveredAtIso } from "@/lib/emprunt/borrow-period";
import { BORROW_OVERDUE_STRIPE_MIN_EUR_CENTS } from "@/lib/stripe/borrow-overdue-penalty-charge";
import { formatBorrowReturnDueDateFr } from "@/lib/cart/cart-borrow-return-due";

import { syncBorrowNonRestitutionChargeFromStripe } from "@/lib/stripe/sync-borrow-non-restitution-charge-from-stripe";

export type MemberBorrowOverdueAppGateChargeDay = MemberCartBorrowOverdueDay;

export type MemberBorrowOverdueAppGate = {
  cartId: string;
  overdueId: string;
  recoveryPhase: string | null;
  recoveryStatus: string;
  overdueStatus: string;
  lateDayIndex: number;
  hasFailedCharge: boolean;
  chargeDays: MemberBorrowOverdueAppGateChargeDay[];
  totalPenaltyCents: number;
  chargedPenaltyCents: number;
  unpaidPenaltyCents: number;
  cartValueCents: number;
  showStripeSettlement: boolean;
  showPaymentRecoveryBanner: boolean;
  nonRestitutionDeadlineLabel: string;
  nonRestitutionDeadlineIsProjected: boolean;
  formalNoticeSent: boolean;
  formalNoticeDeadlineLabel: string | null;
  formalNoticeDeadlinePassed: boolean;
  nonRestitutionSettled: boolean;
  nonRestitutionInvoiced: boolean;
  /** À partir du délai MED / facture émise : modale simplifiée. */
  postRestitutionDeadline: boolean;
  nonRestitutionInvoiceUrl: string | null;
  nonRestitutionInvoiceTotalCents: number;
  hasOpenDispute: boolean;
  empruntHref: string;
  regulariserHref: string;
  problemeHref: string;
};

function isPathUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Chemins accessibles malgré la modale blocage (page commande/emprunt, retour, profil paiement si échec prélèvement). */
export function isBorrowOverdueGateAllowedPath(
  pathname: string,
  searchParams: URLSearchParams | ReadonlyURLSearchParams | null,
  gate: MemberBorrowOverdueAppGate,
): boolean {
  const cartId = gate.cartId;

  if (isPathUnder(pathname, `/exchange/emprunt/${cartId}`)) return true;
  if (isPathUnder(pathname, `/exchange/emprunt/${cartId}/regulariser`)) return true;
  if (isPathUnder(pathname, `/exchange/retour/${cartId}`)) return true;

  const commandeBase = `/commande/${cartId}`;
  if (isPathUnder(pathname, commandeBase)) return true;

  if (gate.hasFailedCharge && pathname === "/profile" && searchParams?.get("tab") === "plus") {
    return true;
  }

  return false;
}

type ReadonlyURLSearchParams = Pick<URLSearchParams, "get">;

function isAtOrPastRestitutionDeadlineDay(nowMs: number, formalNoticeDeadlineIso: string | null): boolean {
  const raw = formalNoticeDeadlineIso?.trim();
  if (!raw) return false;
  const deadlineMs = Date.parse(raw);
  if (!Number.isFinite(deadlineMs)) return false;
  const tz = "Europe/Paris";
  const deadlineParis = new Date(deadlineMs).toLocaleDateString("en-CA", { timeZone: tz });
  const nowParis = new Date(nowMs).toLocaleDateString("en-CA", { timeZone: tz });
  return nowParis >= deadlineParis;
}

/**
 * Panier emprunt en retard sans retour engagé → modale blocage app (PR3).
 */
export async function fetchMemberBorrowOverdueAppGate(
  supabase: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
  opts?: { admin?: SupabaseClient },
): Promise<MemberBorrowOverdueAppGate | null> {
  const { data: overdueRows, error: oErr } = await supabase
    .from("cart_borrow_overdue")
    .select(
      "id,cart_id,status,recovery_phase,recovery_status,formal_notice_sent_at,formal_notice_deadline_at,non_restitution_invoice_id,non_restitution_charge_cents",
    )
    .eq("user_id", userId)
    .in("status", ["active", "escalated"])
    .order("updated_at", { ascending: false })
    .limit(20);

  if (oErr || !overdueRows?.length) return null;

  for (const row of overdueRows as {
    id: string;
    cart_id: string;
    status: string;
    recovery_phase: string | null;
    recovery_status?: string | null;
    formal_notice_sent_at?: string | null;
    formal_notice_deadline_at?: string | null;
    non_restitution_charge_cents?: number | null;
  }[]) {
    const cartId = row.cart_id;

    const { data: cart } = await supabase
      .from("carts")
      .select("id,status,borrow_return_due_at,deleted_at")
      .eq("id", cartId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!cart || cart.deleted_at != null) continue;
    if (!["confirmed", "archived", "disputed"].includes(String(cart.status ?? ""))) continue;

    const { data: terminalResolvedOverdue } = await supabase
      .from("cart_borrow_overdue")
      .select("id, recovery_phase")
      .eq("cart_id", cartId)
      .eq("status", "resolved")
      .in("recovery_phase", ["waived", "resolved_paid", "resolved_return"])
      .limit(1)
      .maybeSingle();

    if (terminalResolvedOverdue?.id) continue;

    const { data: outboundRows } = await supabase
      .from("shipments")
      .select("delivered_at,updated_at")
      .eq("cart_id", cartId)
      .eq("context", "cart_outbound")
      .eq("status", "delivered")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    const outbound = (outboundRows ?? [])[0] as { delivered_at?: string | null; updated_at?: string } | undefined;
    const outboundAnchor = resolveOutboundBorrowDeliveredAtIso(
      outbound?.delivered_at,
      outbound?.updated_at,
    );
    if (!outboundAnchor) continue;

    const extensionDaysByCartId = await fetchCartBorrowExtensionDaysByCartIds(supabase, [cartId]);
    const dueMs = await ensureCartBorrowReturnDueAt(supabase, {
      cartId,
      userId,
      borrowReturnDueAtIso: cart.borrow_return_due_at,
      outboundDeliveredAtIso: outbound?.delivered_at ?? null,
      outboundUpdatedAtIso: outboundAnchor,
      borrowExtensionDaysTotal: extensionDaysByCartId.get(cartId) ?? 0,
    });

    if (!Number.isFinite(dueMs) || !isBorrowReturnOverdueParis(nowMs, dueMs)) continue;

    const lateDayIndex = borrowOverdueLateDayIndex(nowMs, dueMs);
    if (lateDayIndex < 1) continue;

    const { data: retRows } = await supabase
      .from("shipments")
      .select("status")
      .eq("cart_id", cartId)
      .eq("context", "cart_return")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    const returnStatus = (retRows?.[0] as { status?: string } | undefined)?.status ?? null;
    const returnCommitmentMet = isCartReturnCommitmentMet(returnStatus);

    if (
      !shouldBlockAppForBorrowOverdue({
        overdueStatus: row.status,
        recoveryPhase: row.recovery_phase,
        returnCommitmentMet,
        lateDayIndex,
      })
    ) {
      continue;
    }

    const overdueSnapshot = await fetchMemberCartBorrowOverdue(supabase, cartId);
    const chargeDays = overdueSnapshot?.days ?? [];
    let chargedPenaltyCents = 0;
    let unpaidPenaltyCents = 0;
    let hasFailedCharge = false;

    for (const day of chargeDays) {
      if (day.chargeStatus === "charged") {
        chargedPenaltyCents += Math.max(0, day.penaltyCents);
      } else {
        unpaidPenaltyCents += Math.max(0, day.penaltyCents);
        if (day.chargeStatus === "failed") hasFailedCharge = true;
      }
    }

    const totalPenaltyCents = overdueSnapshot?.totalPenaltyCents ?? chargedPenaltyCents + unpaidPenaltyCents;
    const showStripeSettlement =
      hasFailedCharge || unpaidPenaltyCents >= BORROW_OVERDUE_STRIPE_MIN_EUR_CENTS;
    const showPaymentRecoveryBanner =
      row.recovery_phase === "payment_recovery" ||
      String(row.recovery_status ?? "") === "requires_action" ||
      String(row.recovery_status ?? "") === "recovery_required" ||
      (hasFailedCharge && unpaidPenaltyCents >= BORROW_OVERDUE_STRIPE_MIN_EUR_CENTS);

    const formalNoticeSent = Boolean(String(row.formal_notice_sent_at ?? "").trim());
    const formalNoticeDeadlineIso = String(row.formal_notice_deadline_at ?? "").trim();
    const formalNoticeDeadlineMs = formalNoticeDeadlineIso ? Date.parse(formalNoticeDeadlineIso) : Number.NaN;
    const formalNoticeDeadlinePassed =
      formalNoticeSent &&
      Number.isFinite(formalNoticeDeadlineMs) &&
      nowMs > formalNoticeDeadlineMs;

    const { deadlineMs, isProjected } = resolveBorrowNonRestitutionDeadlineMs({
      borrowReturnDueMs: dueMs,
      formalNoticeSentAtIso: row.formal_notice_sent_at,
      formalNoticeDeadlineAtIso: row.formal_notice_deadline_at,
    });

    const { data: nonRestitutionCharge } = await supabase
      .from("cart_borrow_non_restitution_charges")
      .select("id,overdue_id,status,stripe_invoice_id,stripe_invoice_hosted_url,amount_cents,unpaid_penalty_cents")
      .eq("cart_id", cartId)
      .maybeSingle();

    let chargeRow = nonRestitutionCharge as {
      id?: string;
      overdue_id?: string;
      status?: string;
      stripe_invoice_id?: string | null;
      stripe_invoice_hosted_url?: string | null;
      amount_cents?: number;
      unpaid_penalty_cents?: number;
    } | null;

    if (opts?.admin && chargeRow?.id) {
      const synced = await syncBorrowNonRestitutionChargeFromStripe(opts.admin, {
        id: chargeRow.id,
        overdue_id: chargeRow.overdue_id ?? row.id,
        status: chargeRow.status,
        stripe_invoice_id: chargeRow.stripe_invoice_id,
        stripe_invoice_hosted_url: chargeRow.stripe_invoice_hosted_url,
      });
      if (synced.paid) {
        chargeRow = {
          ...chargeRow,
          status: "succeeded",
          stripe_invoice_hosted_url: synced.hostedInvoiceUrl,
        };
        row.recovery_phase = "non_restitution_charged";
      } else if (synced.hostedInvoiceUrl) {
        chargeRow = {
          ...chargeRow,
          stripe_invoice_hosted_url: synced.hostedInvoiceUrl,
        };
      }
    }

    const recoveryPhase = row.recovery_phase;
    const recoveryStatus = String(row.recovery_status ?? "none");
    const chargeSucceeded = String(chargeRow?.status ?? "").toLowerCase() === "succeeded";
    const nonRestitutionSettled =
      recoveryPhase === "non_restitution_charged" ||
      recoveryPhase === "resolved_paid" ||
      chargeSucceeded;

    const nonRestitutionInvoiceUrl =
      String(chargeRow?.stripe_invoice_hosted_url ?? "").trim() || null;

    const nonRestitutionInvoiced =
      Boolean(nonRestitutionInvoiceUrl) ||
      recoveryPhase === "non_restitution_due" ||
      recoveryPhase === "non_restitution_charged";

    const invoiceTotalFromCharge = Math.max(
      0,
      Number(chargeRow?.amount_cents ?? 0) + Number(chargeRow?.unpaid_penalty_cents ?? 0),
    );

    const nonRestitutionInvoiceTotalCents =
      invoiceTotalFromCharge ||
      Math.max(0, Number(row.non_restitution_charge_cents ?? 0)) ||
      (nonRestitutionInvoiced ? Math.max(0, Number(overdueSnapshot?.cartValueCents ?? 0) + unpaidPenaltyCents) : 0);

    const postRestitutionDeadline =
      formalNoticeDeadlinePassed ||
      isAtOrPastRestitutionDeadlineDay(nowMs, formalNoticeDeadlineIso) ||
      nonRestitutionInvoiced ||
      nonRestitutionSettled;

    const { data: openDispute } = await supabase
      .from("cart_disputes")
      .select("id")
      .eq("cart_id", cartId)
      .is("deleted_at", null)
      .in("status", ["open", "in_review"])
      .limit(1)
      .maybeSingle();

    const hasOpenDispute = Boolean(openDispute?.id) || String(cart.status ?? "") === "disputed";

    return {
      cartId,
      overdueId: row.id,
      recoveryPhase,
      recoveryStatus,
      overdueStatus: row.status,
      lateDayIndex,
      hasFailedCharge,
      chargeDays,
      totalPenaltyCents,
      chargedPenaltyCents,
      unpaidPenaltyCents,
      cartValueCents: overdueSnapshot?.cartValueCents ?? 0,
      showStripeSettlement,
      showPaymentRecoveryBanner,
      nonRestitutionDeadlineLabel: formatBorrowReturnDueDateFr(deadlineMs),
      nonRestitutionDeadlineIsProjected: isProjected,
      formalNoticeSent,
      formalNoticeDeadlineLabel: formalNoticeSent
        ? formatBorrowReturnDueDateFr(formalNoticeDeadlineMs)
        : null,
      formalNoticeDeadlinePassed,
      nonRestitutionSettled,
      nonRestitutionInvoiced,
      postRestitutionDeadline,
      nonRestitutionInvoiceUrl,
      nonRestitutionInvoiceTotalCents,
      hasOpenDispute,
      empruntHref: `/exchange/emprunt/${cartId}`,
      regulariserHref: `/exchange/emprunt/${cartId}/regulariser`,
      problemeHref: `/commande/${cartId}/probleme?kind=borrow`,
    };
  }

  return null;
}
