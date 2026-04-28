const STORAGE_KEY = "segna_pre_cart_path";

/** Page de repli si aucun historique valide (ex. premier chargement direct sur `/cart`). */
export const CART_EXIT_FALLBACK_PATH = "/exchange";

export function isCartFlowPathname(pathname: string): boolean {
  return pathname === "/cart" || pathname.startsWith("/cart/");
}

function pathOnly(p: string): string {
  const q = p.indexOf("?");
  return q === -1 ? p : p.slice(0, q);
}

/** true si navigation interne app relative et hors flux panier. */
export function isAllowedCartExitTarget(pathWithOptionalQuery: string): boolean {
  const t = pathWithOptionalQuery.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return false;
  const base = pathOnly(t);
  return !isCartFlowPathname(base);
}

export function rememberPathForCartExit(pathnameOrPath: string): void {
  if (typeof window === "undefined") return;
  const p = pathnameOrPath.trim();
  if (!p || !isAllowedCartExitTarget(p)) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, p);
  } catch {
    // ignore quota / private mode
  }
}

export function readStoredPreCartPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === "") return null;
    return raw.trim();
  } catch {
    return null;
  }
}

export function exitCartFlow(router: { push: (href: string) => void }): void {
  const stored = readStoredPreCartPath();
  if (stored && isAllowedCartExitTarget(stored)) {
    router.push(stored);
    return;
  }
  router.push(CART_EXIT_FALLBACK_PATH);
}
