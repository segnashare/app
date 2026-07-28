const STORAGE_KEY_PREFIX = "segna_x_welcome_seen_v1";

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

export function hasSeenSegnaXWelcome(userId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    return true;
  }
}

export function markSegnaXWelcomeSeen(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), "1");
  } catch {
    /* quota / private mode */
  }
}
