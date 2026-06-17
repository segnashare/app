import posthog from "posthog-js";

import type { AnalyticsEventName, AnalyticsEventProperties } from "@/lib/analytics/events";

const SIGNED_UP_GUARD_KEY = "segna:ph:signed_up";

/** Fire at most once per browser profile (signup). */
export function trackClientSignupOnce(
  properties: AnalyticsEventProperties["user_signed_up"],
): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(SIGNED_UP_GUARD_KEY) === "1") return;
    sessionStorage.setItem(SIGNED_UP_GUARD_KEY, "1");
  } catch {
    // ignore quota errors
  }
  trackClientEvent("user_signed_up", properties);
}

export function trackClientEvent<E extends AnalyticsEventName>(
  event: E,
  properties?: AnalyticsEventProperties[E],
  options?: { insertId?: string },
): void {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.capture(event, {
    ...(properties ?? {}),
    ...(options?.insertId ? { $insert_id: options.insertId } : {}),
  });
}
