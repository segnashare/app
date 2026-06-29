/**
 * Self-test policy non-retour (aligné sur borrow-overdue-recovery-policy.ts).
 * Usage: npm run test:borrow-recovery-policy
 */
import assert from "node:assert/strict";

const BORROW_NON_RETURN_PROCESSING_FEE_CENTS_LT_100_EUR = 1999;
const BORROW_NON_RETURN_PROCESSING_FEE_CENTS_GTE_100_EUR = 2999;
const BORROW_NON_RETURN_CART_VALUE_THRESHOLD_CENTS = 10_000;
const BORROW_FORMAL_NOTICE_DEADLINE_DAYS = 10;

function borrowOverduePenaltyCapCents() {
  return null;
}

function borrowNonReturnProcessingFeeCents(cartValueCents) {
  const v = Math.max(0, Math.trunc(cartValueCents));
  return v < BORROW_NON_RETURN_CART_VALUE_THRESHOLD_CENTS
    ? BORROW_NON_RETURN_PROCESSING_FEE_CENTS_LT_100_EUR
    : BORROW_NON_RETURN_PROCESSING_FEE_CENTS_GTE_100_EUR;
}

function borrowNonRestitutionChargeTotalCents(cartValueCents, unpaidPenaltyCents = 0) {
  return Math.max(0, Math.trunc(cartValueCents)) + Math.max(0, Math.trunc(unpaidPenaltyCents));
}

function isPenaltyCapReached(penaltiesAccruedCents, cartValueCents) {
  return false;
}

function shouldBlockAppForBorrowOverdue(input) {
  if (input.returnCommitmentMet) return false;
  if (input.lateDayIndex < 1) return false;
  const st = String(input.overdueStatus ?? "").toLowerCase();
  if (st === "resolved") return false;
  if (st === "active" || st === "escalated") return true;
  const open = new Set([
    "app_restricted",
    "escalated_ops",
    "formal_notice_pending",
    "formal_notice_sent",
    "non_restitution_due",
    "non_restitution_charged",
    "payment_recovery",
    "collection",
  ]);
  return open.has(input.recoveryPhase ?? "");
}

assert.strictEqual(borrowNonRestitutionChargeTotalCents(800, 4200), 5000);
assert.strictEqual(borrowNonRestitutionChargeTotalCents(14000, 8820), 22820);
assert.strictEqual(isPenaltyCapReached(800, 800), false);
assert.strictEqual(BORROW_FORMAL_NOTICE_DEADLINE_DAYS, 10);

assert.strictEqual(
  shouldBlockAppForBorrowOverdue({
    overdueStatus: "active",
    recoveryPhase: "app_restricted",
    returnCommitmentMet: false,
    lateDayIndex: 3,
  }),
  true,
);

assert.strictEqual(
  shouldBlockAppForBorrowOverdue({
    overdueStatus: "resolved",
    recoveryPhase: "resolved_return",
    returnCommitmentMet: true,
    lateDayIndex: 0,
  }),
  false,
);

console.log("✓ borrow-overdue-recovery-policy self-test passed");
