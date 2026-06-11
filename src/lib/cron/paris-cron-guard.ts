import { NextResponse } from "next/server";

import { type ParisCronSlot, isParisCronSlot } from "@/lib/datetime/segna-datetime";

/** Créneaux quotidiens / hebdo en heure de Paris (indépendants UTC / DST). */
export const PARIS_CRON_SLOTS = {
  borrowOverdueAccrual: { hour: 10, minute: 0 },
  onboardingReminders: { hour: 15, minute: 0 },
  abandonedCartReminders: { hour: 18, minute: 0 },
  borrowReturnReminders: { hour: 19, minute: 30 },
  /** Lundi 08:00 Paris — recalibrage économie. */
  economyExchangeRecalibration: { hour: 8, minute: 0, weekday: 1 },
  /** Chaque jour 06:00 Paris — agrégation signaux demande. */
  economyDemandMetrics: { hour: 6, minute: 0 },
} as const satisfies Record<string, ParisCronSlot>;

export function parisCronGuardResponse(
  slot: ParisCronSlot,
  nowMs: number = Date.now(),
): NextResponse | null {
  if (isParisCronSlot(slot, nowMs)) return null;
  return NextResponse.json({ ok: true as const, skipped: true, reason: "not_paris_slot" });
}
