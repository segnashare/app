export type BorrowRecoveryAuthSuspendState = {
  suspendedAt: string;
  cartId: string;
  reason: string | null;
};

function isPathUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Chemins accessibles malgré la suspension auth (régularisation, retour, profil paiement). */
export function isBorrowRecoveryAuthSuspendAllowedPath(
  pathname: string,
  searchParams: URLSearchParams | { get: (key: string) => string | null } | null,
  cartId: string,
): boolean {
  if (pathname === "/auth/emprunt-suspendu") return true;

  if (isPathUnder(pathname, `/exchange/emprunt/${cartId}`)) return true;
  if (isPathUnder(pathname, `/exchange/retour/${cartId}`)) return true;

  const commandeBase = `/commande/${cartId}`;
  if (isPathUnder(pathname, commandeBase)) return true;

  if (pathname === "/profile" && searchParams?.get("tab") === "plus") return true;

  if (pathname.startsWith("/api/stripe/borrow-overdue")) return true;

  return false;
}

export function parseBorrowRecoveryAuthSuspendRow(row: {
  borrow_recovery_suspended_at?: string | null;
  borrow_recovery_suspend_cart_id?: string | null;
  borrow_recovery_suspend_reason?: string | null;
} | null): BorrowRecoveryAuthSuspendState | null {
  const suspendedAt = String(row?.borrow_recovery_suspended_at ?? "").trim();
  const cartId = String(row?.borrow_recovery_suspend_cart_id ?? "").trim();
  if (!suspendedAt || !cartId) return null;

  return {
    suspendedAt,
    cartId,
    reason: String(row?.borrow_recovery_suspend_reason ?? "").trim() || null,
  };
}
