import { parseSendcloudRelayPointRef } from "@/lib/sendcloud/relay-point-ref";

export type CheckoutReturnRelayMeta = {
  returnRelayPointId: string | null;
  returnRelayLabel: string | null;
  returnRelaySearchPostalCode: string | null;
};

export function readCheckoutReturnRelayFromOutboundMetadata(
  metadata: Record<string, unknown> | null | undefined,
): CheckoutReturnRelayMeta {
  const m = metadata && typeof metadata === "object" ? metadata : {};
  return {
    returnRelayPointId:
      typeof m.return_relay_code === "string" && m.return_relay_code.trim()
        ? m.return_relay_code.trim()
        : null,
    returnRelayLabel:
      typeof m.return_relay_label === "string" && m.return_relay_label.trim()
        ? m.return_relay_label.trim()
        : null,
    returnRelaySearchPostalCode:
      typeof m.return_relay_search_postal_code === "string" && m.return_relay_search_postal_code.trim()
        ? m.return_relay_search_postal_code.trim().replace(/\D/g, "").slice(0, 5)
        : null,
  };
}

export function isResolvableReturnHubRelayCode(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (parseSendcloudRelayPointRef(t)) return true;
  if (/^sc:\d+/i.test(t)) return true;
  if (/^FR-\d+/i.test(t)) return true;
  return false;
}
