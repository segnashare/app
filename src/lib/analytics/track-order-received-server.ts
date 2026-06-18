import "server-only";

import type { AnalyticsEventProperties } from "@/lib/analytics/events";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { trackServerEvent } from "@/lib/analytics/track-server";

type OrderReceivedProps = Omit<AnalyticsEventProperties["order_received"], "cart_id">;

export function trackOrderReceivedServer(
  userId: string,
  cartId: string,
  properties?: OrderReceivedProps,
): void {
  if (!cartId) return;
  trackServerEvent(
    ANALYTICS_EVENTS.orderReceived,
    {
      distinctId: userId,
      insertId: `order_received:${cartId}`,
    },
    {
      cart_id: cartId,
      ...properties,
    },
  );
}
