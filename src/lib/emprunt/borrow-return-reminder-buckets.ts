import {
  borrowCalendarDaysUntilDue,
  isBorrowReturnDueJjDayParis,
  isBorrowReturnOverdueParis,
} from "@/lib/cart/borrow-return-calendar";
import type { SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";

export const BORROW_RETURN_REMINDER_MS_PER_DAY = 86_400_000;

export type BorrowReturnReminderPhase = "jminus7" | "jminus3" | "jminus1" | "jj" | "overdue";

export type BorrowReturnReminderPick = {
  idempotencyBucket: string;
  phase: BorrowReturnReminderPhase;
  templateDaysLeft: number;
};

/** Dernier jour calendaire avant dépassement (minuit Paris suivant). */
export function isBorrowReturnDueJjDay(nowMs: number, deadlineMs: number): boolean {
  return isBorrowReturnDueJjDayParis(nowMs, deadlineMs);
}

function isSubscriberMembership(membership: SegnaBorrowMembershipLabel): boolean {
  return membership === "Membre +" || membership === "Membre X";
}

/**
 * Rappels cron avant échéance uniquement (jours calendaires Paris).
 * Guest : J-3, J-1, J-J — Membre + / X : J-7, J-3, J-J.
 * Les jours de retard (J+1…) sont gérés par `borrowOverdueDaily` (accrue + notify séparés).
 */
export function pickBorrowReturnReminder(
  nowMs: number,
  deadlineMs: number,
  membership: SegnaBorrowMembershipLabel,
): BorrowReturnReminderPick | null {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || !Number.isFinite(nowMs)) return null;

  if (isBorrowReturnOverdueParis(nowMs, deadlineMs)) {
    return null;
  }

  const daysLeft = borrowCalendarDaysUntilDue(nowMs, deadlineMs);
  if (!Number.isFinite(daysLeft)) return null;

  if (daysLeft === 7 && isSubscriberMembership(membership)) {
    return { idempotencyBucket: "jminus7", phase: "jminus7", templateDaysLeft: 7 };
  }
  if (daysLeft === 3) {
    return { idempotencyBucket: "jminus3", phase: "jminus3", templateDaysLeft: 3 };
  }
  if (daysLeft === 1) {
    return { idempotencyBucket: "jminus1", phase: "jminus1", templateDaysLeft: 1 };
  }
  if (daysLeft === 0) {
    return { idempotencyBucket: "jj", phase: "jj", templateDaysLeft: 0 };
  }
  return null;
}
