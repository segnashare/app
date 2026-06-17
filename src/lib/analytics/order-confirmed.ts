import "server-only";

import type { AnalyticsEventProperties } from "@/lib/analytics/events";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { trackServerEvent } from "@/lib/analytics/track-server";

type OrderConfirmedProps = AnalyticsEventProperties["order_confirmed"];

export function exchangeOrderSuccessUrl(
  origin: string,
  cartId: string,
  checkoutMode: OrderConfirmedProps["checkout_mode"] = "stripe",
): string {
  const url = new URL("/exchange", origin || "http://localhost");
  url.searchParams.set("cart", "success");
  url.searchParams.set("cart_id", cartId);
  if (checkoutMode) {
    url.searchParams.set("checkout_mode", checkoutMode);
  }
  return url.pathname + url.search;
}

export function trackOrderConfirmedServer(
  userId: string,
  properties: OrderConfirmedProps,
): void {
  if (!properties.cart_id || properties.cart_id === "unknown") return;
  trackServerEvent(ANALYTICS_EVENTS.orderConfirmed, {
    distinctId: userId,
    insertId: `order_confirmed:${properties.cart_id}`,
  }, properties);
}
