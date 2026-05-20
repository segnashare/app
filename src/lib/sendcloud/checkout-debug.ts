import type { SendcloudDeliveryOption } from "@/lib/sendcloud/dynamic-checkout";

const LOG_PREFIX = "[sendcloud-checkout]";

export function isSendcloudCheckoutDebugEnabled(): boolean {
  if (process.env.SENDCLOUD_CHECKOUT_DEBUG === "1") return true;
  return process.env.NODE_ENV === "development";
}

export function logSendcloudCheckout(scope: string, payload: unknown): void {
  if (!isSendcloudCheckoutDebugEnabled()) return;
  try {
    console.log(`${LOG_PREFIX} ${scope}`, JSON.stringify(payload, null, 2));
  } catch {
    console.log(`${LOG_PREFIX} ${scope}`, payload);
  }
}

export function serializeSendcloudOptionForDebug(o: SendcloudDeliveryOption): Record<string, unknown> {
  return {
    id: o.id,
    title: o.title,
    delivery_method_type: o.deliveryMethodType,
    checkout_option_code: o.checkoutIdentifierValue,
    carrier_code: o.carrierCode,
    carrier_name: o.carrierName,
    shipping_rate_cents: o.shippingRateCents,
  };
}
