const PENDING_KEY = "segna_subscription_cancel_pending_v1";
const PERIOD_END_KEY = "segna_subscription_cancel_period_end_v1";

export function markSubscriptionCancelPending(periodEndIso: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_KEY, "1");
    if (periodEndIso) window.localStorage.setItem(PERIOD_END_KEY, periodEndIso);
  } catch {
    /* ignore */
  }
}

export function isSubscriptionCancelPending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function readSubscriptionCancelPeriodEnd(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PERIOD_END_KEY);
  } catch {
    return null;
  }
}

export function clearSubscriptionCancelPending(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_KEY, "0");
    window.localStorage.removeItem(PERIOD_END_KEY);
  } catch {
    /* ignore */
  }
}
