import type { SupabaseClient } from "@supabase/supabase-js";

import { mapBorrowOverdueSettleErrorToChargeContext } from "@/lib/cart/format-borrow-overdue-copy";
import type { BorrowOverdueAccrueResult } from "@/lib/emprunt/borrow-overdue-penalty";
import { notifyBorrowOverdueDaily } from "@/lib/notifications/lifecycle-shipment-notify";

/**
 * Cron matin : e-mail + SMS si la pénalité du jour n'a pas été prélevée (cumul < 0,50 € ou carte absente/refusée).
 */
export async function notifyBorrowOverdueDailyWhenUnsettled(
  admin: SupabaseClient,
  input: {
    userId: string;
    cartId: string;
    calendarDate: string;
    accrue: BorrowOverdueAccrueResult;
    settleError?: string | null;
    cronSmsNowMs?: number;
  },
): Promise<boolean> {
  const penaltyCents = Math.max(0, Math.trunc(Number(input.accrue.penalty_cents ?? 0)));
  if (penaltyCents <= 0) {
    return false;
  }

  const chargeStatus = String(input.accrue.charge_status ?? "pending");
  const ctx = mapBorrowOverdueSettleErrorToChargeContext({
    chargeStatus,
    settleError: input.settleError,
  });

  if (ctx.chargeStatus === "charged") {
    return false;
  }

  const lateDayIndex = Math.max(1, Math.trunc(Number(input.accrue.late_day ?? 1)));
  const rateBps = Math.max(0, Math.trunc(Number(input.accrue.rate_bps ?? 300)));
  const penaltyCredits = Math.max(0, Math.trunc(Number(input.accrue.penalty_credits ?? 0)));

  await notifyBorrowOverdueDaily(admin, {
    userId: input.userId,
    cartId: input.cartId,
    lateDayIndex,
    penaltyCents,
    penaltyCredits,
    rateBps,
    chargeStatus: ctx.chargeStatus,
    chargeFailureReason: ctx.chargeFailureReason,
    calendarDate: input.calendarDate,
    cronSmsNowMs: input.cronSmsNowMs,
  });

  return true;
}
