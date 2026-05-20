/** Choix transporteur aller (Dynamic Checkout) au paiement. */

export const CHECKOUT_SENDCLOUD_OUTBOUND_RELAY_KEY = "segna:checkout-sendcloud-outbound-relay";
export const CHECKOUT_SENDCLOUD_OUTBOUND_HOME_KEY = "segna:checkout-sendcloud-outbound-home";

export type CheckoutSendcloudOutboundOption = {
  optionCode: string;
  optionId: string;
  title: string;
  carrierCode: string;
  carrierName: string;
  shippingRateCents: number | null;
};

function storageKey(channel: "relay" | "home"): string {
  return channel === "relay"
    ? CHECKOUT_SENDCLOUD_OUTBOUND_RELAY_KEY
    : CHECKOUT_SENDCLOUD_OUTBOUND_HOME_KEY;
}

function parseStored(raw: string | null): CheckoutSendcloudOutboundOption | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as CheckoutSendcloudOutboundOption;
    if (typeof o?.optionCode !== "string" || !o.optionCode.trim()) return null;
    return {
      optionCode: o.optionCode.trim(),
      optionId: typeof o.optionId === "string" ? o.optionId.trim() : "",
      title: typeof o.title === "string" ? o.title.trim() : "Livraison",
      carrierCode: typeof o.carrierCode === "string" ? o.carrierCode.trim() : "",
      carrierName: typeof o.carrierName === "string" ? o.carrierName.trim() : "",
      shippingRateCents:
        typeof o.shippingRateCents === "number" && Number.isFinite(o.shippingRateCents)
          ? o.shippingRateCents
          : null,
    };
  } catch {
    return null;
  }
}

export function readCheckoutSendcloudOutboundOption(
  channel: "relay" | "home",
): CheckoutSendcloudOutboundOption | null {
  if (typeof window === "undefined") return null;
  return parseStored(window.sessionStorage.getItem(storageKey(channel)));
}

export function writeCheckoutSendcloudOutboundOption(
  channel: "relay" | "home",
  value: CheckoutSendcloudOutboundOption | null,
) {
  if (typeof window === "undefined") return;
  const key = storageKey(channel);
  if (value == null) {
    window.sessionStorage.removeItem(key);
    return;
  }
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

export type SendcloudOutboundCheckoutMeta = {
  sendcloud_outbound_option_code: string;
  sendcloud_outbound_option_id: string;
  sendcloud_outbound_method_title: string;
  sendcloud_outbound_carrier: string;
};

export function sendcloudOutboundMetaFromSelection(
  sel: CheckoutSendcloudOutboundOption,
): SendcloudOutboundCheckoutMeta {
  return {
    sendcloud_outbound_option_code: sel.optionCode.slice(0, 120),
    sendcloud_outbound_option_id: sel.optionId.slice(0, 64),
    sendcloud_outbound_method_title: sel.title.slice(0, 120),
    sendcloud_outbound_carrier: sel.carrierCode.slice(0, 40),
  };
}

export function readSendcloudOutboundMetaFromRecord(
  metadata: Record<string, unknown> | null | undefined,
): SendcloudOutboundCheckoutMeta | null {
  const m = metadata && typeof metadata === "object" ? metadata : {};
  const code =
    typeof m.sendcloud_outbound_option_code === "string"
      ? m.sendcloud_outbound_option_code.trim()
      : "";
  if (!code) return null;
  return {
    sendcloud_outbound_option_code: code,
    sendcloud_outbound_option_id:
      typeof m.sendcloud_outbound_option_id === "string" ? m.sendcloud_outbound_option_id.trim() : "",
    sendcloud_outbound_method_title:
      typeof m.sendcloud_outbound_method_title === "string"
        ? m.sendcloud_outbound_method_title.trim()
        : "",
    sendcloud_outbound_carrier:
      typeof m.sendcloud_outbound_carrier === "string" ? m.sendcloud_outbound_carrier.trim() : "",
  };
}
