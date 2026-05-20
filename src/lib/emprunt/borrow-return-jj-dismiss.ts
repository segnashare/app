const STORAGE_PREFIX = "segna_borrow_return_jj_dismiss_v1";

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function borrowReturnJjDismissStorageKey(cartId: string): string {
  return `${STORAGE_PREFIX}:${cartId.trim()}:${todayKeyUtc()}`;
}

export function isBorrowReturnJjDismissed(cartId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(borrowReturnJjDismissStorageKey(cartId)) === "1";
  } catch {
    return false;
  }
}

export function dismissBorrowReturnJjForToday(cartId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(borrowReturnJjDismissStorageKey(cartId), "1");
  } catch {
    /* ignore */
  }
}
