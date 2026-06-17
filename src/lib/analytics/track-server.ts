import "server-only";

import { PostHog } from "posthog-node";

import type { AnalyticsEventName, AnalyticsEventProperties } from "@/lib/analytics/events";

let posthogServer: PostHog | null = null;

function getPostHogServer(): PostHog | null {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return null;
  if (!posthogServer) {
    posthogServer = new PostHog(apiKey, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogServer;
}

export type TrackServerEventOptions = {
  distinctId: string;
  /** PostHog deduplication key (e.g. `order_confirmed:${cartId}`). */
  insertId?: string;
};

export function trackServerEvent<E extends AnalyticsEventName>(
  event: E,
  options: TrackServerEventOptions,
  properties?: AnalyticsEventProperties[E],
): void {
  const client = getPostHogServer();
  if (!client) return;

  client.capture({
    distinctId: options.distinctId,
    event,
    properties: {
      ...(properties ?? {}),
      ...(options.insertId ? { $insert_id: options.insertId } : {}),
    },
  });
}

/** Best-effort flush for serverless handlers. */
export async function flushServerAnalytics(): Promise<void> {
  await posthogServer?.shutdown();
  posthogServer = null;
}
