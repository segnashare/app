import "server-only";

import type { AnalyticsEventProperties } from "@/lib/analytics/events";
import { borrowDurationAnalyticsProps, borrowDurationLabelForAnalytics } from "@/lib/analytics/borrow-duration-analytics";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { trackServerEvent } from "@/lib/analytics/track-server";

type OrderConfirmedProps = AnalyticsEventProperties["order_confirmed"];

export function parseOrderConfirmedItemCount(
  metadata: Record<string, string | undefined> | null | undefined,
  fallback?: number,
): number | undefined {
  const raw = metadata?.item_count;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number.parseInt(String(raw).trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback != null && fallback > 0 ? fallback : undefined;
}

function parseNonNegativeInt(raw: unknown): number | undefined {
  if (raw == null || String(raw).trim() === "") return undefined;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export type OrderCheckoutEconomics = Pick<
  AnalyticsEventProperties["order_confirmed"],
  "cash_paid_cents" | "cart_credits_mods" | "missing_credits_mods" | "borrow_duration_days" | "borrow_duration_label"
>;

/** Lit les montants checkout depuis metadata Stripe (cart checkout). */
export function parseOrderCheckoutEconomicsFromMetadata(
  metadata: Record<string, string | undefined> | null | undefined,
): OrderCheckoutEconomics {
  const creditsLineCents = parseNonNegativeInt(metadata?.credits_line_cents);
  const feesTtcCents = parseNonNegativeInt(metadata?.fees_ttc_cents);
  const cartCreditsMods = parseNonNegativeInt(metadata?.cart_total_mods);
  const missingCreditsMods = parseNonNegativeInt(metadata?.missing_exchange_mods);
  const borrowDurationDays = parseNonNegativeInt(metadata?.borrow_duration_days);

  let cashPaidCents: number | undefined;
  if (creditsLineCents != null || feesTtcCents != null) {
    cashPaidCents = (creditsLineCents ?? 0) + (feesTtcCents ?? 0);
  }

  return {
    ...(cashPaidCents != null ? { cash_paid_cents: cashPaidCents } : {}),
    ...(cartCreditsMods != null ? { cart_credits_mods: cartCreditsMods } : {}),
    ...(missingCreditsMods != null ? { missing_credits_mods: missingCreditsMods } : {}),
    ...(borrowDurationDays != null
      ? borrowDurationAnalyticsProps(borrowDurationDays)
      : {}),
  };
}

/** Metadata Stripe + montant réel encaissé (`amount_total`) si session paiement. */
export function parseOrderCheckoutEconomicsFromStripeSession(session: {
  amount_total?: number | null;
  metadata?: Record<string, string> | null;
}): OrderCheckoutEconomics {
  const fromMeta = parseOrderCheckoutEconomicsFromMetadata(session.metadata ?? undefined);
  const amountTotal = session.amount_total;
  if (amountTotal != null && Number.isFinite(amountTotal) && amountTotal >= 0) {
    return { ...fromMeta, cash_paid_cents: amountTotal };
  }
  return fromMeta;
}

export function orderCheckoutEconomicsDirect(input: {
  cartTotalMods: number;
  cashPaidCents?: number;
  missingExchangeMods?: number;
  borrowDurationDays?: number;
}): OrderCheckoutEconomics {
  return {
    cash_paid_cents: input.cashPaidCents ?? 0,
    cart_credits_mods: input.cartTotalMods,
    ...(input.missingExchangeMods != null ? { missing_credits_mods: input.missingExchangeMods } : {}),
    ...(input.borrowDurationDays != null
      ? borrowDurationAnalyticsProps(input.borrowDurationDays)
      : {}),
  };
}

export { borrowDurationLabelForAnalytics };

export function exchangeOrderSuccessUrl(
  origin: string,
  cartId: string,
  checkoutMode: OrderConfirmedProps["checkout_mode"] = "stripe",
  itemCount?: number,
): string {
  const url = new URL("/exchange", origin || "http://localhost");
  url.searchParams.set("cart", "success");
  url.searchParams.set("cart_id", cartId);
  if (checkoutMode) {
    url.searchParams.set("checkout_mode", checkoutMode);
  }
  if (itemCount != null && itemCount > 0) {
    url.searchParams.set("item_count", String(itemCount));
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
