import type { SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";

const MS_PER_DAY = 86_400_000;

export type BorrowReturnReminderPhase = "jminus7" | "jminus3" | "jminus1" | "jj" | "overdue";

export type BorrowReturnReminderPick = {
  idempotencyBucket: string;
  phase: BorrowReturnReminderPhase;
  /** Métadonnées / compat : jours entiers avant l’instant échéance (0 = dernier jour ou retard). */
  templateDaysLeft: number;
};

/**
 * Rappels relatifs à l’échéance de retour (cron quotidien recommandé) :
 * - **Guest** (10 j.) : J-3, J-1, JJ, puis un envoi par jour de retard.
 * - **Membre + / Membre X** : J-7, J-3, JJ, puis retard.
 *
 * Fenêtres en **demi-journées calées sur l’UI** (jours restants au plafond) : J-3 = [2j ; 4j[
 * avant l’échéance (ex. ~71 h restantes comptent encore comme « 3 jours » à l’écran), pas seulement floor === 3.
 */
export function pickBorrowReturnReminder(
  nowMs: number,
  deadlineMs: number,
  membership: SegnaBorrowMembershipLabel,
): BorrowReturnReminderPick | null {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || !Number.isFinite(nowMs)) return null;

  const msLeft = deadlineMs - nowMs;
  if (msLeft <= 0) {
    const overdueIdx = Math.floor((nowMs - deadlineMs) / MS_PER_DAY);
    return {
      idempotencyBucket: `overdue_${overdueIdx}`,
      phase: "overdue",
      templateDaysLeft: 0,
    };
  }

  const d = MS_PER_DAY;

  if (membership === "Guest") {
    if (msLeft >= 2 * d && msLeft < 4 * d) {
      return { idempotencyBucket: "guest_jminus3", phase: "jminus3", templateDaysLeft: 3 };
    }
    if (msLeft >= d && msLeft < 2 * d) {
      return { idempotencyBucket: "guest_jminus1", phase: "jminus1", templateDaysLeft: 1 };
    }
    if (msLeft > 0 && msLeft < d) {
      return { idempotencyBucket: "guest_jj", phase: "jj", templateDaysLeft: 0 };
    }
    return null;
  }

  if (msLeft >= 7 * d && msLeft < 8 * d) {
    return { idempotencyBucket: "mem_jminus7", phase: "jminus7", templateDaysLeft: 7 };
  }
  if (msLeft >= 2 * d && msLeft < 4 * d) {
    return { idempotencyBucket: "mem_jminus3", phase: "jminus3", templateDaysLeft: 3 };
  }
  if (msLeft > 0 && msLeft < d) {
    return { idempotencyBucket: "mem_jj", phase: "jj", templateDaysLeft: 0 };
  }
  return null;
}
