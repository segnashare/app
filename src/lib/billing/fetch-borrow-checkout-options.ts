export type BorrowCheckoutOption = {
  durationDays: number;
  label: string;
  centsPerMissingCredit: number;
  sortOrder: number;
};

/** Valeurs par défaut (alignées migration economy v2) — tarifs Guest location. */
export const BORROW_CHECKOUT_OPTIONS_FALLBACK: BorrowCheckoutOption[] = [
  { durationDays: 7, label: "7 jours", centsPerMissingCredit: 10, sortOrder: 1 },
  { durationDays: 14, label: "14 jours", centsPerMissingCredit: 15, sortOrder: 2 },
  { durationDays: 30, label: "1 mois", centsPerMissingCredit: 20, sortOrder: 3 },
];

/**
 * Complément abonné (SegnaX) quand le panier dépasse le budget wallet :
 * durée fixe 1 mois à 10 % du prix d’achat (1 point = 1 € → 10 cts / point manquant).
 */
export const MEMBER_BORROW_COMPLEMENT_DURATION_DAYS = 30;
export const MEMBER_BORROW_COMPLEMENT_CENTS_PER_CREDIT = 10;

export function computeMemberBorrowComplementCashCents(missingCredits: number): number {
  const missing = Math.max(0, Math.trunc(missingCredits));
  if (missing <= 0) return 0;
  return missing * MEMBER_BORROW_COMPLEMENT_CENTS_PER_CREDIT;
}

type RpcRow = {
  duration_days: number | string;
  label: string | null;
  cents_per_missing_credit: number | string;
  sort_order: number | string;
};

function parseRpcRows(data: unknown): BorrowCheckoutOption[] {
  if (!Array.isArray(data) || data.length === 0) return BORROW_CHECKOUT_OPTIONS_FALLBACK;
  const parsed = (data as RpcRow[])
    .map((row) => ({
      durationDays: Number(row.duration_days),
      label: String(row.label ?? `${row.duration_days} j`),
      centsPerMissingCredit: Number(row.cents_per_missing_credit),
      sortOrder: Number(row.sort_order ?? 0),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.durationDays) &&
        row.durationDays >= 1 &&
        Number.isFinite(row.centsPerMissingCredit) &&
        row.centsPerMissingCredit >= 0,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.durationDays - b.durationDays);
  return parsed.length > 0 ? parsed : BORROW_CHECKOUT_OPTIONS_FALLBACK;
}

/** Lit les durées/tarifs checkout actifs (RPC Supabase). */
export async function fetchBorrowCheckoutOptions(supabase: {
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
}): Promise<BorrowCheckoutOption[]> {
  const { data, error } = await supabase.rpc("billing_borrow_checkout_options_active");
  if (error) return BORROW_CHECKOUT_OPTIONS_FALLBACK;
  return parseRpcRows(data);
}

export function centsPerMissingCreditForDuration(
  options: ReadonlyArray<BorrowCheckoutOption>,
  durationDays: number,
): number {
  const match = options.find((o) => o.durationDays === durationDays);
  if (match) return match.centsPerMissingCredit;
  const fallback = BORROW_CHECKOUT_OPTIONS_FALLBACK.find((o) => o.durationDays === durationDays);
  return fallback?.centsPerMissingCredit ?? BORROW_CHECKOUT_OPTIONS_FALLBACK[0].centsPerMissingCredit;
}

export function computeMissingCreditsCashCents(
  missingCredits: number,
  durationDays: number,
  options: ReadonlyArray<BorrowCheckoutOption>,
): number {
  const missing = Math.max(0, Math.trunc(missingCredits));
  if (missing <= 0) return 0;
  const rate = centsPerMissingCreditForDuration(options, durationDays);
  return missing * rate;
}

/** Équivalent € location pour une pièce (crédits × tarif crédit manquant à la durée choisie). */
export function computeItemRentalEuroCents(
  pricePoints: number | null | undefined,
  durationDays: number,
  options: ReadonlyArray<BorrowCheckoutOption>,
): number {
  const points =
    typeof pricePoints === "number" && !Number.isNaN(pricePoints) ? Math.max(0, Math.trunc(pricePoints)) : 0;
  return computeMissingCreditsCashCents(points, durationDays, options);
}

export function formatEuroPerCredit(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function shortestBorrowCheckoutOption(
  options: ReadonlyArray<BorrowCheckoutOption>,
): BorrowCheckoutOption {
  const sorted = [...options].sort((a, b) => a.durationDays - b.durationDays || a.sortOrder - b.sortOrder);
  return sorted[0] ?? BORROW_CHECKOUT_OPTIONS_FALLBACK[0]!;
}

/** Libellé court pour l’UI panier / checkout (« 7 jours », « 1 mois », etc.). */
export function formatBorrowCheckoutDurationLabel(
  durationDays: number,
  options: ReadonlyArray<BorrowCheckoutOption>,
): string {
  const days =
    Number.isFinite(durationDays) && durationDays >= 1 ? Math.trunc(durationDays) : 30;
  const match = options.find((o) => o.durationDays === days);
  const label = match?.label?.trim();
  if (label === "1 mois" || days === 30) return "1 mois";
  if (label) return label;
  return `${days} jours`;
}

/** Complément € / jour (part crédits manquants uniquement). */
export function computeBorrowComplementDailyEuroCents(
  missingCredits: number,
  durationDays: number,
  options: ReadonlyArray<BorrowCheckoutOption>,
): number {
  const missing = Math.max(0, Math.trunc(missingCredits));
  if (missing <= 0 || durationDays <= 0) return 0;
  const totalCents = computeMissingCreditsCashCents(missing, durationDays, options);
  return Math.round(totalCents / durationDays);
}

/** Réduction affichée du prix loc/jour vs la durée la plus courte (valeurs marketing). */
export function computeBorrowDailyPriceDisplayDiscountPercent(
  durationDays: number,
  options: ReadonlyArray<BorrowCheckoutOption>,
): number {
  const sorted = [...options].sort((a, b) => a.durationDays - b.durationDays || a.sortOrder - b.sortOrder);
  const tierIndex = sorted.findIndex((o) => o.durationDays === durationDays);
  if (tierIndex <= 0) return 0;
  if (tierIndex === 1) return 25;
  return 50;
}

/** @deprecated Préférer computeBorrowDailyPriceDisplayDiscountPercent pour l'UI. */
export function computeBorrowDailyPriceDiscountPercent(
  durationDays: number,
  options: ReadonlyArray<BorrowCheckoutOption>,
): number {
  const base = shortestBorrowCheckoutOption(options);
  if (durationDays <= base.durationDays) return 0;
  const baseDailyRate = base.centsPerMissingCredit / base.durationDays;
  const currentRate = centsPerMissingCreditForDuration(options, durationDays);
  const currentDailyRate = currentRate / durationDays;
  if (baseDailyRate <= 0 || currentDailyRate >= baseDailyRate) return 0;
  return Math.round((1 - currentDailyRate / baseDailyRate) * 100);
}

export function formatEuroPerDay(centsPerDay: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsPerDay / 100);
}
