const DEFAULT_CREATE_RETURN_TO = "/home";

export function isSafeInAppReturnPath(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//");
}

export function resolveCreateInspirationReturnTo(raw: string | null | undefined): string {
  if (raw && isSafeInAppReturnPath(raw)) return raw.trim();
  return DEFAULT_CREATE_RETURN_TO;
}

export function createInspirationHref(returnTo?: string | null): string {
  const resolved = resolveCreateInspirationReturnTo(returnTo);
  return `/community/create?returnTo=${encodeURIComponent(resolved)}`;
}

export function lookDetailHref(lookId: string, from?: string | null): string {
  const id = lookId.trim();
  if (!id) return resolveCreateInspirationReturnTo(from);
  const base = `/look/${id}`;
  if (!from || !isSafeInAppReturnPath(from)) return base;
  return `${base}?from=${encodeURIComponent(from.trim())}`;
}
