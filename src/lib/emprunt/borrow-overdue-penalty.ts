import { BORROW_RETURN_TZ, borrowCalendarDaysUntilDue } from "@/lib/cart/borrow-return-calendar";

/** Conversion pénalité € → crédits wallet débités (5 cts/crédit, aligné wallet/prolongation). */
export const BORROW_PENALTY_CENTS_PER_CREDIT = 5;

/** Taux fixe des frais de retard : 3 % de la valeur panier par jour. */
export const BORROW_OVERDUE_RATE_BPS = 300;

export const BORROW_OVERDUE_MAX_ACCRUAL_DAY = 14;

export type BorrowOverdueRateTier = "week1" | "week2";

export function borrowOverdueRateBps(_lateDayIndex?: number): number {
  return BORROW_OVERDUE_RATE_BPS;
}

/** @deprecated Taux unique 3 % — conservé pour compat. */
export function borrowOverdueRateTier(lateDayIndex: number): BorrowOverdueRateTier {
  return lateDayIndex <= 7 ? "week1" : "week2";
}

export function penaltyCentsFromCartValue(cartValueCents: number, lateDayIndex: number): number {
  const base = Math.max(0, Math.trunc(cartValueCents));
  const bps = borrowOverdueRateBps(lateDayIndex);
  return Math.round((base * bps) / 10_000);
}

export function penaltyCreditsFromCents(penaltyCents: number): number {
  const c = Math.max(0, Math.trunc(penaltyCents));
  if (c <= 0) return 0;
  return Math.ceil(c / BORROW_PENALTY_CENTS_PER_CREDIT);
}

export function borrowOverdueMessageKey(lateDayIndex: number): string {
  const d = Math.max(1, Math.min(60, Math.trunc(lateDayIndex)));
  return `borrow_overdue_day_${d}`;
}

/** Index jour de retard (1 = 1er jour après la date limite Paris). */
export function borrowOverdueLateDayIndex(nowMs: number, dueMs: number): number {
  const daysUntil = borrowCalendarDaysUntilDue(nowMs, dueMs);
  if (!Number.isFinite(daysUntil) || daysUntil >= 0) return 0;
  return -daysUntil;
}

export function parisCalendarDateString(nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BORROW_RETURN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

export type BorrowOverdueAccrueResult = {
  ok: boolean;
  applied?: boolean;
  duplicate?: boolean;
  skipped?: string;
  late_day?: number;
  penalty_cents?: number;
  penalty_credits?: number;
  message_key?: string;
  charge_status?: string;
  rate_bps?: number;
  day_id?: string;
  error?: string;
};
