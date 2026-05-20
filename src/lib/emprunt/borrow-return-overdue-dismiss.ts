const STORAGE_PREFIX = "segna_borrow_return_overdue_dismiss_v1";

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function borrowReturnOverdueDismissStorageKey(cartId: string): string {
  return `${STORAGE_PREFIX}:${cartId.trim()}:${todayKeyUtc()}`;
}

export function isBorrowReturnOverdueDismissed(cartId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(borrowReturnOverdueDismissStorageKey(cartId)) === "1";
  } catch {
    return false;
  }
}

export function dismissBorrowReturnOverdueForToday(cartId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(borrowReturnOverdueDismissStorageKey(cartId), "1");
  } catch {
    /* ignore */
  }
}
