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

const NEW_ITEM_SCROLL_KEY = "segna:new-item:scroll-y";
const NEW_ITEM_SCROLL_RESTORE_PENDING = "segna:new-item:scroll-restore-pending";

let strictModeScrollFallback: number | null = null;
let strictModeScrollFallbackClearId: number | null = null;

function scheduleClearNewItemScrollFallback() {
  if (typeof window === "undefined") return;
  if (strictModeScrollFallbackClearId != null) window.clearTimeout(strictModeScrollFallbackClearId);
  strictModeScrollFallbackClearId = window.setTimeout(() => {
    strictModeScrollFallback = null;
    strictModeScrollFallbackClearId = null;
  }, 280);
}

/** Avant une sous-route (catégorie, taille, …) : mémorise le scroll du formulaire principal. */
export function persistNewItemScrollForSubPage(): void {
  if (typeof window === "undefined") return;
  const y = window.scrollY;
  strictModeScrollFallback = y;
  if (strictModeScrollFallbackClearId != null) {
    window.clearTimeout(strictModeScrollFallbackClearId);
    strictModeScrollFallbackClearId = null;
  }
  try {
    window.sessionStorage.setItem(NEW_ITEM_SCROLL_KEY, String(y));
    window.sessionStorage.setItem(NEW_ITEM_SCROLL_RESTORE_PENDING, "1");
  } catch {
    // ignore
  }
}

export function stashNewItemScrollForStrictRemount(scrollY: number): void {
  if (typeof window === "undefined") return;
  strictModeScrollFallback = scrollY;
  if (strictModeScrollFallbackClearId != null) {
    window.clearTimeout(strictModeScrollFallbackClearId);
    strictModeScrollFallbackClearId = null;
  }
  scheduleClearNewItemScrollFallback();
}

function takeNewItemScrollStrictRemountFallback(): number | null {
  if (typeof window === "undefined") return null;
  if (strictModeScrollFallbackClearId != null) {
    window.clearTimeout(strictModeScrollFallbackClearId);
    strictModeScrollFallbackClearId = null;
  }
  const y = strictModeScrollFallback;
  strictModeScrollFallback = null;
  return y;
}

/** Au retour sur `/items/new` : position à restaurer (ou null). */
export function consumeNewItemScrollRestore(): number | null {
  if (typeof window === "undefined") return null;

  const fromSession = (() => {
    try {
      if (window.sessionStorage.getItem(NEW_ITEM_SCROLL_RESTORE_PENDING) !== "1") return null;
      window.sessionStorage.removeItem(NEW_ITEM_SCROLL_RESTORE_PENDING);
      const raw = window.sessionStorage.getItem(NEW_ITEM_SCROLL_KEY);
      window.sessionStorage.removeItem(NEW_ITEM_SCROLL_KEY);
      const y = raw != null ? Number(raw) : NaN;
      return Number.isFinite(y) ? y : null;
    } catch {
      return null;
    }
  })();

  if (fromSession != null) return fromSession;
  return takeNewItemScrollStrictRemountFallback();
}
