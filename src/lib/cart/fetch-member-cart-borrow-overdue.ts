export type MemberCartBorrowOverdueDay = {
  id: string;
  lateDayIndex: number;
  calendarDate: string;
  rateBps: number;
  penaltyCents: number;
  penaltyCredits: number;
  chargeStatus: string;
  messageKey: string;
};

export type MemberCartBorrowOverdueSnapshot = {
  overdueId: string;
  status: string;
  cartValueCents: number;
  days: MemberCartBorrowOverdueDay[];
  totalPenaltyCents: number;
  totalPenaltyCredits: number;
  hasFailedCharge: boolean;
  latestLateDayIndex: number;
};

type OverdueRow = {
  id?: string;
  status?: string;
  cart_value_cents?: number;
};

type DayRow = {
  id?: string;
  late_day_index?: number;
  calendar_date?: string;
  rate_bps?: number;
  penalty_cents?: number;
  penalty_credits?: number;
  charge_status?: string;
  message_key?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (table: string) => any };

/**
 * Dossier retard actif ou escaladé + journal des jours (page emprunt).
 */
export async function fetchMemberCartBorrowOverdue(
  supabase: SupabaseLike,
  cartId: string,
): Promise<MemberCartBorrowOverdueSnapshot | null> {
  const { data: overdueRows, error: oErr } = await supabase
    .from("cart_borrow_overdue")
    .select("id,status,cart_value_cents,updated_at")
    .eq("cart_id", cartId);

  if (oErr || !Array.isArray(overdueRows) || overdueRows.length === 0) return null;

  const open = (overdueRows as OverdueRow[]).find((r) => {
    const st = String(r.status ?? "").toLowerCase();
    return st === "active" || st === "escalated";
  });
  if (!open?.id) return null;

  const status = String(open.status ?? "").toLowerCase();
  const overdueId = String(open.id);

  const { data: dayRows, error: dErr } = await supabase
    .from("cart_borrow_overdue_days")
    .select(
      "id,late_day_index,calendar_date,rate_bps,penalty_cents,penalty_credits,charge_status,message_key",
    )
    .eq("cart_id", cartId)
    .order("late_day_index", { ascending: true });

  if (dErr) return null;

  const days: MemberCartBorrowOverdueDay[] = ((dayRows ?? []) as DayRow[]).map((row) => ({
    id: String(row.id ?? ""),
    lateDayIndex: Number(row.late_day_index ?? 0),
    calendarDate: String(row.calendar_date ?? ""),
    rateBps: Number(row.rate_bps ?? 0),
    penaltyCents: Number(row.penalty_cents ?? 0),
    penaltyCredits: Number(row.penalty_credits ?? 0),
    chargeStatus: String(row.charge_status ?? "pending"),
    messageKey: String(row.message_key ?? ""),
  }));

  let totalPenaltyCents = 0;
  let totalPenaltyCredits = 0;
  let hasFailedCharge = false;
  let latestLateDayIndex = 0;

  for (const d of days) {
    totalPenaltyCents += Math.max(0, d.penaltyCents);
    totalPenaltyCredits += Math.max(0, d.penaltyCredits);
    if (d.chargeStatus === "failed") hasFailedCharge = true;
    if (d.lateDayIndex > latestLateDayIndex) latestLateDayIndex = d.lateDayIndex;
  }

  if (latestLateDayIndex < 1) return null;

  return {
    overdueId,
    status,
    cartValueCents: Number(open.cart_value_cents ?? 0),
    days,
    totalPenaltyCents,
    totalPenaltyCredits,
    hasFailedCharge,
    latestLateDayIndex,
  };
}
