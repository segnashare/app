import {
  addParisCalendarDays,
  borrowReturnDueEndOfParisDayMs,
  borrowReturnParisDateKey,
} from "@/lib/cart/borrow-return-calendar";

export const BORROW_OVERDUE_PENALTY_CAP_PCT = null as null;

export const BORROW_NON_RETURN_PROCESSING_FEE_CENTS_LT_100_EUR = 1999;
export const BORROW_NON_RETURN_PROCESSING_FEE_CENTS_GTE_100_EUR = 2999;
export const BORROW_NON_RETURN_CART_VALUE_THRESHOLD_CENTS = 10_000;

export const BORROW_FORMAL_NOTICE_DAY = 21;
export const BORROW_FORMAL_NOTICE_DEADLINE_DAYS = 10;
export const BORROW_ESCALATION_OPS_DAY = 15;
export const BORROW_APP_RESTRICTION_DAY = 1;

/** @deprecated Plus de plafond sur les frais de retard. */
export function borrowOverduePenaltyCapCents(_cartValueCents: number): number | null {
  return null;
}

/** Frais de traitement non-retour TTC (19,99 € / 29,99 €). */
export function borrowNonReturnProcessingFeeCents(cartValueCents: number): number {
  const v = Math.max(0, Math.trunc(cartValueCents));
  return v < BORROW_NON_RETURN_CART_VALUE_THRESHOLD_CENTS
    ? BORROW_NON_RETURN_PROCESSING_FEE_CENTS_LT_100_EUR
    : BORROW_NON_RETURN_PROCESSING_FEE_CENTS_GTE_100_EUR;
}

/** Échéance MED = sent_at + 10 j (calendaires). */
export function borrowFormalNoticeDeadlineMs(sentAtMs: number): number {
  return sentAtMs + BORROW_FORMAL_NOTICE_DEADLINE_DAYS * 86_400_000;
}

/** Date limite indemnité non-restitution estimée (échéance retour + J+21 MED + 10 j délai). */
export function projectedBorrowNonRestitutionDeadlineMs(borrowReturnDueMs: number): number {
  const dueParis = borrowReturnParisDateKey(borrowReturnDueMs);
  const deadlineParis = addParisCalendarDays(
    dueParis,
    BORROW_FORMAL_NOTICE_DAY + BORROW_FORMAL_NOTICE_DEADLINE_DAYS,
  );
  return borrowReturnDueEndOfParisDayMs(deadlineParis);
}

export function resolveBorrowNonRestitutionDeadlineMs(opts: {
  borrowReturnDueMs: number;
  formalNoticeSentAtIso?: string | null;
  formalNoticeDeadlineAtIso?: string | null;
}): { deadlineMs: number; isProjected: boolean } {
  const storedDeadline = String(opts.formalNoticeDeadlineAtIso ?? "").trim();
  if (storedDeadline) {
    const ms = Date.parse(storedDeadline);
    if (Number.isFinite(ms)) return { deadlineMs: ms, isProjected: false };
  }

  const sentAt = String(opts.formalNoticeSentAtIso ?? "").trim();
  if (sentAt) {
    const sentMs = Date.parse(sentAt);
    if (Number.isFinite(sentMs)) {
      return { deadlineMs: borrowFormalNoticeDeadlineMs(sentMs), isProjected: false };
    }
  }

  return {
    deadlineMs: projectedBorrowNonRestitutionDeadlineMs(opts.borrowReturnDueMs),
    isProjected: true,
  };
}

export function borrowFormalNoticeDeadlineIso(sentAtIso: string): string {
  const ms = borrowFormalNoticeDeadlineMs(new Date(sentAtIso).getTime());
  return new Date(ms).toISOString();
}

/** Montant facture non-restitution = valeur panier + frais de retard non réglés. */
export function borrowNonRestitutionChargeTotalCents(
  cartValueCents: number,
  unpaidPenaltyCents: number = 0,
): number {
  return Math.max(0, Math.trunc(cartValueCents)) + Math.max(0, Math.trunc(unpaidPenaltyCents));
}

export function isPenaltyCapReached(_penaltiesAccruedCents: number, _cartValueCents: number): boolean {
  return false;
}

/** Self-test léger (scripts/test-borrow-overdue-recovery-policy.mjs). */
export function runBorrowOverdueRecoveryPolicySelfTest(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  assert(borrowNonReturnProcessingFeeCents(800) === 1999, "fee lt 100");
  assert(borrowNonReturnProcessingFeeCents(10_000) === 2999, "fee gte 100");
  assert(borrowNonRestitutionChargeTotalCents(800, 4200) === 5000, "charge total");
  assert(borrowNonRestitutionChargeTotalCents(800, 0) === 800, "charge cart only");
  assert(!isPenaltyCapReached(800, 800), "no penalty cap");
  assert(BORROW_FORMAL_NOTICE_DEADLINE_DAYS === 10, "med deadline");
  assert(
    projectedBorrowNonRestitutionDeadlineMs(Date.parse("2026-01-01T12:00:00Z")) > 0,
    "projected deadline",
  );
}
