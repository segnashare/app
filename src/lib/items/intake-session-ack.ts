const INTAKE_SESSION_ACK_KEY = "segna:intake-session-ack";

export function intakeSessionAckKey(itemId: string, listingStage: string): string {
  return `${itemId}:${listingStage}`;
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
  } catch {
    // no-op
  }
}
