import type { AnalyticsEventName, AnalyticsEventProperties } from "@/lib/analytics/events";
import { trackClientEvent } from "@/lib/analytics/track-client";

/** Fire a page/tab view event at most once per browser tab session. */
export function trackPageOnce<E extends AnalyticsEventName>(
  sessionKey: string,
  event: E,
  properties?: AnalyticsEventProperties[E],
): void {
  if (typeof window === "undefined") return;
  const storageKey = `segna:ph:page:${sessionKey}`;
  try {
    if (sessionStorage.getItem(storageKey) === "1") return;
    sessionStorage.setItem(storageKey, "1");
  } catch {
    // ignore quota errors — still try to capture
  }
  trackClientEvent(event, properties);
}
