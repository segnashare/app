/** 0,02 € par crédit (point) et par jour de prolongation. */
export const BORROW_EXTENSION_CENTS_PER_CREDIT_PER_DAY = 2;

/** Libellé affiché (€ / crédit / jour). */
export const BORROW_EXTENSION_EURO_PER_CREDIT_DAY_LABEL = "0,02";

export const BORROW_EXTENSION_MIN_DAYS = 1;
export const BORROW_EXTENSION_MAX_DAYS = 60;

/** Somme des crédits de toutes les lignes du panier (prolongation = commande entière). */
export function computeBorrowExtensionCreditsForCart(
  lines: ReadonlyArray<{ pricePoints: number }>,
): number {
  let total = 0;
  for (const line of lines) {
    const pts = Number.isFinite(line.pricePoints) ? Math.max(0, Math.trunc(line.pricePoints)) : 0;
    total += pts;
  }
  return total;
}

export function computeBorrowExtensionAmountCents(creditsTotal: number, extensionDays: number): number {
  const credits = Math.max(0, Math.trunc(creditsTotal));
  const days = Math.max(0, Math.trunc(extensionDays));
  if (credits <= 0 || days <= 0) return 0;
  return credits * days * BORROW_EXTENSION_CENTS_PER_CREDIT_PER_DAY;
}

export function formatBorrowExtensionEuroTtc(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}

export function clampBorrowExtensionDays(days: number): number {
  if (!Number.isFinite(days)) return BORROW_EXTENSION_MIN_DAYS;
  return Math.min(BORROW_EXTENSION_MAX_DAYS, Math.max(BORROW_EXTENSION_MIN_DAYS, Math.trunc(days)));
}
