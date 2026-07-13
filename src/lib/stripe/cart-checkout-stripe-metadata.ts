import type { ConfirmCartReturnRelayFields } from "@/lib/stripe/cart-order-fulfillment";
import type { CheckoutDeliveryAddress } from "@/lib/cart/checkout-delivery-storage";
import type { CheckoutSendcloudOutboundOption } from "@/lib/cart/checkout-sendcloud-outbound-option";

type DeliveryChannel = "relay" | "home";

export type BuildCartOrderCheckoutMetadataInput = {
  checkoutKind: "cart_order" | "cart_order_wallet_setup";
  userId: string;
  cartId: string;
  itemCount: number;
  deliveryChannel: DeliveryChannel;
  homeSpeedBilling: "standard" | "uber_direct";
  deliveryAddress: CheckoutDeliveryAddress | null;
  deliveryInstructions: string;
  relayMeta: string;
  deliveryLine1Meta: string;
  returnRelayFields: ConfirmCartReturnRelayFields;
  missingExchangeMods: number;
  cartTotalMods: number;
  borrowDurationDays: number;
  centsPerMissingCredit: number;
  exchangeCreditsKind: string;
  creditsCents: number;
  shippingHtCents: number;
  serviceHtCents: number;
  fees: {
    shippingTtcCents: number;
    serviceTtcCents: number;
    feesVatCents: number;
    feesTtcCents: number;
  };
  billedRoundTripHtCents: number;
  remainingIncludedOrders: number;
  usedIncludedOrder: boolean;
  includedExchangeShipping: string;
  priorityCents: number;
  sendcloudOutboundSelection: CheckoutSendcloudOutboundOption | null;
  coursierSelection?: {
    slotKey: string;
    serviceId: string;
    pickupStartDate: string;
    deliveryStartDate: string;
    deliveryEndDate: string;
  } | null;
  guestCashRental?: boolean;
  purchaseMode?: boolean;
};

export function buildCartOrderCheckoutMetadata(
  input: BuildCartOrderCheckoutMetadataInput,
): Record<string, string> {
  return {
    checkout_kind: input.checkoutKind,
    user_id: input.userId,
    cart_id: input.cartId,
    item_count: String(input.itemCount),
    delivery_channel: input.deliveryChannel,
    home_speed: input.homeSpeedBilling === "uber_direct" ? "uber_direct" : "standard",
    delivery_lat:
      input.deliveryChannel === "home" && input.deliveryAddress != null ? String(input.deliveryAddress.lat) : "",
    delivery_lon:
      input.deliveryChannel === "home" && input.deliveryAddress != null ? String(input.deliveryAddress.lon) : "",
    delivery_city:
      input.deliveryChannel === "home" && input.deliveryAddress != null
        ? (input.deliveryAddress.city ?? input.deliveryAddress.relativeCity ?? "").trim().slice(0, 120)
        : "",
    delivery_instructions:
      input.deliveryChannel === "home" && input.deliveryInstructions ? input.deliveryInstructions.slice(0, 450) : "",
    missing_exchange_mods: String(input.missingExchangeMods),
    cart_total_mods: String(input.cartTotalMods),
    borrow_duration_days: String(input.borrowDurationDays),
    cents_per_missing_credit: String(input.centsPerMissingCredit),
    exchange_credits_kind: input.exchangeCreditsKind,
    credits_line_cents: String(input.creditsCents),
    shipping_cents: String(input.shippingHtCents),
    service_cents: String(input.serviceHtCents),
    shipping_ht_cents: String(input.shippingHtCents),
    shipping_ttc_cents: String(input.fees.shippingTtcCents),
    shipping_round_trip_waived:
      input.remainingIncludedOrders > 0 && input.billedRoundTripHtCents === 0 ? "true" : "false",
    used_included_order: input.usedIncludedOrder ? "true" : "false",
    shipping_included_kind: String(input.includedExchangeShipping),
    remaining_included_orders_at_checkout: String(input.remainingIncludedOrders),
    round_trip_shipping_ht_cents_if_billed: String(input.billedRoundTripHtCents),
    priority_cents: String(input.priorityCents),
    service_ht_cents: String(input.serviceHtCents),
    service_ttc_cents: String(input.fees.serviceTtcCents),
    fees_vat_cents: String(input.fees.feesVatCents),
    fees_ttc_cents: String(input.fees.feesTtcCents),
    relay_code: input.relayMeta,
    delivery_line1: input.deliveryLine1Meta,
    return_relay_code: input.returnRelayFields.returnRelayPointId,
    return_relay_label: input.returnRelayFields.returnRelayLabel,
    return_relay_search_postal_code: input.returnRelayFields.returnRelaySearchPostalCode,
    ...(input.coursierSelection
      ? {
          coursier_slot_key: input.coursierSelection.slotKey.slice(0, 180),
          coursier_service_id: input.coursierSelection.serviceId.slice(0, 32),
          coursier_pickup_start: input.coursierSelection.pickupStartDate.slice(0, 32),
          coursier_delivery_start: input.coursierSelection.deliveryStartDate.slice(0, 32),
          coursier_delivery_end: input.coursierSelection.deliveryEndDate.slice(0, 32),
        }
      : {}),
    ...(input.sendcloudOutboundSelection
      ? {
          sendcloud_outbound_option_code: input.sendcloudOutboundSelection.optionCode.slice(0, 120),
          sendcloud_outbound_option_id: input.sendcloudOutboundSelection.optionId.slice(0, 64),
          sendcloud_outbound_method_title: input.sendcloudOutboundSelection.title.slice(0, 120),
          sendcloud_outbound_carrier: input.sendcloudOutboundSelection.carrierCode.slice(0, 40),
        }
      : {}),
    ...(input.guestCashRental ? { guest_cash_rental: "true" } : {}),
    ...(input.purchaseMode ? { purchase_mode: "true" } : {}),
  };
}
