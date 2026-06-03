export const CHECKOUT_BORROW_DURATION_DAYS_KEY = "segna:checkout-borrow-duration-days";

export function readCheckoutBorrowDurationDays(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_BORROW_DURATION_DAYS_KEY);
    if (!raw) return null;
    const n = Math.trunc(Number(raw));
    return Number.isFinite(n) && n >= 1 && n <= 90 ? n : null;
  } catch {
    return null;
  }
}

export function writeCheckoutBorrowDurationDays(durationDays: number) {
  if (typeof window === "undefined") return;
  const n = Math.trunc(durationDays);
  if (!Number.isFinite(n) || n < 1 || n > 90) return;
  window.sessionStorage.setItem(CHECKOUT_BORROW_DURATION_DAYS_KEY, String(n));
}

export function clearCheckoutBorrowDurationDays() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CHECKOUT_BORROW_DURATION_DAYS_KEY);
  } catch {
    // no-op
  }
}

export function resolveCheckoutBorrowDurationDays(
  stored: number | null | undefined,
  options: ReadonlyArray<{ durationDays: number }>,
  fallbackDays = 7,
): number {
  const allowed = new Set(options.map((o) => o.durationDays));
  if (stored != null && allowed.has(stored)) return stored;
  const first = options[0]?.durationDays;
  if (first != null && allowed.has(first)) return first;
  if (allowed.has(fallbackDays)) return fallbackDays;
  return options[0]?.durationDays ?? fallbackDays;
}

export function defaultCheckoutBorrowDurationDays(
  options: ReadonlyArray<{ durationDays: number }>,
  fallbackDays = 7,
): number {
  return resolveCheckoutBorrowDurationDays(null, options, fallbackDays);
}
