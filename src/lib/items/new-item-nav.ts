/** Après Soumettre : bloque l’accès au flux new item pour cet item (levé par ?from=item ou session). */
export const POST_SUBMIT_BLOCK_PREFIX = "segna:item-post-submit-block:";
/** Entrée volontaire depuis la fiche / l’échange : sous-routes sans ?from=item restent autorisées. */
export const FROM_ITEM_SESSION_KEY = "segna:new-item:from-item-session";

export function isPostSubmitBlocked(itemId: string): boolean {
  try {
    return sessionStorage.getItem(`${POST_SUBMIT_BLOCK_PREFIX}${itemId}`) === "1";
  } catch {
    return false;
  }
}

export function clearPostSubmitBlock(itemId: string): void {
  try {
    sessionStorage.removeItem(`${POST_SUBMIT_BLOCK_PREFIX}${itemId}`);
  } catch {
    // ignore
  }
}

export function setPostSubmitBlock(itemId: string): void {
  try {
    sessionStorage.setItem(`${POST_SUBMIT_BLOCK_PREFIX}${itemId}`, "1");
  } catch {
    // ignore
  }
}

export function setFromItemSession(): void {
  try {
    sessionStorage.setItem(FROM_ITEM_SESSION_KEY, "1");
  } catch {
    // ignore
  }
}

export function clearFromItemSession(): void {
  try {
    sessionStorage.removeItem(FROM_ITEM_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function hasFromItemSession(): boolean {
  try {
    return sessionStorage.getItem(FROM_ITEM_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Pour router.push / Link : repasse `from=item` si l’utilisateur est dans une session « modifier ». */
export function withFromItemParam(
  path: string,
  searchParams: { get: (key: string) => string | null },
): string {
  const fromUrl = searchParams.get("from") === "item";
  const fromSession = typeof window !== "undefined" && hasFromItemSession();
  if (!fromUrl && !fromSession) return path;
  if (path.includes("from=item")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}from=item`;
}
