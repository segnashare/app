import {
  INTAKE_FULFILLMENT_SHIPPING,
  normalizeIntakeFulfillmentStage,
} from "@/lib/items/intake-fulfillment-stages";

const INTAKE_SESSION_ACK_KEY = "segna:intake-session-ack";
const INTAKE_SESSION_ACK_CHANGED_EVENT = "segna:intake-session-ack-changed";

/**
 * Clé de masquage session (pile Échange / fiche pièce).
 * Pour `validated`, distingue `ready` et `shipping` : fermer la carte en préparation
 * ne masque pas la relance « colis en route ».
 */
export function intakeSessionAckKey(
  itemId: string,
  listingStage: string,
  fulfillmentStage?: string | null,
): string {
  const ls = String(listingStage ?? "").trim().toLowerCase();
  if (ls === "validated") {
    const fs = normalizeIntakeFulfillmentStage(fulfillmentStage);
    if (fs === INTAKE_FULFILLMENT_SHIPPING) {
      return `${itemId}:validated:shipping`;
    }
    return `${itemId}:validated:ready`;
  }
  return `${itemId}:${listingStage}`;
}

function sortedAckJsonFromParsed(parsed: unknown): string {
  if (!Array.isArray(parsed)) return "[]";
  const strings = parsed.filter((value): value is string => typeof value === "string").sort();
  return JSON.stringify(strings);
}

export function readIntakeSessionAckSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(INTAKE_SESSION_ACK_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function writeIntakeSessionAckSet(next: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(INTAKE_SESSION_ACK_KEY, JSON.stringify([...next]));
    window.dispatchEvent(new CustomEvent(INTAKE_SESSION_ACK_CHANGED_EVENT));
  } catch {
    // no-op
  }
}

/** Masque la carte intake courante (pile Échange / bandeau fiche) après action métier réalisée. */
export function acknowledgeIntakeStageForSession(
  itemId: string,
  listingStage: string,
  fulfillmentStage?: string | null,
): void {
  const next = new Set(readIntakeSessionAckSet());
  next.add(intakeSessionAckKey(itemId, listingStage, fulfillmentStage));
  writeIntakeSessionAckSet(next);
}

/** Same-tab + cross-tab updates for session ack storage. */
export function subscribeIntakeSessionAck(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = () => onChange();
  const onStorage = (e: StorageEvent) => {
    if (e.key === INTAKE_SESSION_ACK_KEY || e.key === null) onChange();
  };
  window.addEventListener(INTAKE_SESSION_ACK_CHANGED_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(INTAKE_SESSION_ACK_CHANGED_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

/** Canonical snapshot string for `useSyncExternalStore` `getSnapshot` (stable when storage unchanged). */
export function getIntakeSessionAckStoreSnapshot(): string {
  if (typeof window === "undefined") return "[]";
  try {
    const raw = window.sessionStorage.getItem(INTAKE_SESSION_ACK_KEY);
    if (!raw) return "[]";
    return sortedAckJsonFromParsed(JSON.parse(raw) as unknown);
  } catch {
    return "[]";
  }
}

/** Matches SSR: sessionStorage is unavailable on the server during the HTML pass. */
export function getIntakeSessionAckServerStoreSnapshot(): string {
  return "[]";
}

export function parseIntakeSessionAckStoreSnapshot(snapshot: string): Set<string> {
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}
