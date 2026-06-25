/** Phases parcours non-retour (`cart_borrow_overdue.recovery_phase`). */

export const BORROW_OVERDUE_RECOVERY_PHASES = [
  "app_restricted",
  "escalated_ops",
  "formal_notice_pending",
  "formal_notice_sent",
  "non_restitution_due",
  "non_restitution_charged",
  "payment_recovery",
  "collection",
  "resolved_return",
  "resolved_paid",
  "waived",
] as const;

export type BorrowOverdueRecoveryPhase = (typeof BORROW_OVERDUE_RECOVERY_PHASES)[number];

export const BORROW_OVERDUE_RECOVERY_STATUSES = [
  "none",
  "retry_scheduled",
  "requires_action",
  "recovery_required",
  "collection",
] as const;

export type BorrowOverdueRecoveryStatus = (typeof BORROW_OVERDUE_RECOVERY_STATUSES)[number];

const OPEN_RECOVERY_PHASES = new Set<BorrowOverdueRecoveryPhase>([
  "app_restricted",
  "escalated_ops",
  "formal_notice_pending",
  "formal_notice_sent",
  "non_restitution_due",
  "non_restitution_charged",
  "payment_recovery",
  "collection",
]);

export function isBorrowOverdueRecoveryPhase(value: string | null | undefined): value is BorrowOverdueRecoveryPhase {
  return BORROW_OVERDUE_RECOVERY_PHASES.includes(value as BorrowOverdueRecoveryPhase);
}

export function isOpenBorrowOverdueRecoveryPhase(phase: string | null | undefined): boolean {
  return isBorrowOverdueRecoveryPhase(phase) && OPEN_RECOVERY_PHASES.has(phase);
}

/** Dossier ouvert côté app gate (J+1 suspension UX). */
export function shouldBlockAppForBorrowOverdue(input: {
  overdueStatus: string | null | undefined;
  recoveryPhase: string | null | undefined;
  returnCommitmentMet: boolean;
  lateDayIndex: number;
}): boolean {
  if (input.returnCommitmentMet) return false;
  if (input.lateDayIndex < 1) return false;

  const st = String(input.overdueStatus ?? "").toLowerCase();
  if (st === "resolved") return false;

  if (st === "active" || st === "escalated") return true;

  return isOpenBorrowOverdueRecoveryPhase(input.recoveryPhase);
}

export function borrowOverdueRecoveryPhaseLabelFr(phase: string | null | undefined): string {
  switch (phase) {
    case "app_restricted":
      return "Retour en retard";
    case "escalated_ops":
      return "Dossier transmis";
    case "formal_notice_pending":
      return "Mise en demeure programmée";
    case "formal_notice_sent":
      return "Mise en demeure envoyée";
    case "non_restitution_due":
      return "Indemnité due";
    case "non_restitution_charged":
      return "Indemnité prélevée";
    case "payment_recovery":
      return "Régularisation requise";
    case "collection":
      return "Recouvrement";
    case "resolved_return":
      return "Retour reçu";
    case "resolved_paid":
      return "Soldé";
    case "waived":
      return "Clôturé (gracieux)";
    default:
      return phase?.replace(/_/g, " ") ?? "—";
  }
}
