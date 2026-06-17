import "server-only";

import type { AnalyticsEventName } from "@/lib/analytics/events";
import { lookupSmsNotificationImpact } from "@/lib/analytics/sms-impact-catalog";
import { trackServerEvent } from "@/lib/analytics/track-server";

function pickString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** PostHog : SMS réellement envoyé (après Twilio OK + journal idempotent). */
export function trackNotificationSentServer(input: {
  userId: string;
  kind: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): void {
  const impact = lookupSmsNotificationImpact(input.kind);

  trackServerEvent(
    "notification_sent",
    {
      distinctId: input.userId,
      insertId: `notification_sent:${input.idempotencyKey}`,
    },
    {
      kind: input.kind,
      channel: "sms",
      expected_goal_event: impact.goalEvent,
      expected_goal_filter_property: impact.goalFilter?.property,
      expected_goal_filter_value: impact.goalFilter?.value,
      conversion_window_hours: impact.windowHours,
      cart_id: pickString(input.metadata, "cart_id"),
      item_id: pickString(input.metadata, "item_id"),
      idempotency_key: input.idempotencyKey,
    },
  );
}

export type SmsGoalEvent = AnalyticsEventName;
