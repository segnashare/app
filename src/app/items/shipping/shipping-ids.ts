import { MEMBER_INTAKE_SHIPMENT_MAX_ITEMS } from "@/lib/items/member-intake-shipment";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseShippingIdsFromSearch(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function shippingIdsAreWellFormed(
  ids: string[],
  max = MEMBER_INTAKE_SHIPMENT_MAX_ITEMS,
): boolean {
  return ids.length >= 1 && ids.length <= max && ids.every((id) => UUID_RE.test(id));
}
