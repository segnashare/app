/** Mode teaser : l’app web est fermée, seul le CTA iOS reste accessible. */
export const AUTH_TEASER_MODE = process.env.NEXT_PUBLIC_AUTH_TEASER_MODE === "true";

/** Page welcome + CTA « Télécharger l'app iOS ». */
export const AUTH_TEASER_LANDING_PATH = "/auth";

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/**
 * Pages / endpoints encore servis en teaser.
 * Tout le reste (login, home, onboarding, etc.) est redirigé vers {@link AUTH_TEASER_LANDING_PATH}.
 */
export function isAuthTeaserAllowedPath(pathname: string) {
  const path = normalizePathname(pathname);
  if (path === AUTH_TEASER_LANDING_PATH) return true;
  if (path === "/api" || path.startsWith("/api/")) return true;
  if (path.startsWith("/.well-known")) return true;
  if (path === "/auth/callback") return true;
  if (path === "/auth/mobile-password-reset") return true;
  if (path === "/auth/reset-password") return true;
  return false;
}
