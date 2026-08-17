import type { MemberCartOrderDetail, MemberCartOrderLine } from "@/lib/cart/fetch-member-cart-order-detail";
import { isCartReturnCommitmentMet } from "@/lib/cart/cart-return-status";

export type BuyoutEligibleLine = MemberCartOrderLine & {
  itemStatus?: string | null;
  disputeLineStatus?: string | null;
};

/** Pièces encore achetable depuis une location en cours. */
export function filterBuyoutEligibleLines(
  lines: readonly BuyoutEligibleLine[],
): BuyoutEligibleLine[] {
  return lines.filter((line) => {
    if (String(line.disputeLineStatus ?? "").trim() === "lost_not_returned") return false;
    const status = String(line.itemStatus ?? "reserved").trim().toLowerCase();
    if (status === "sold" || status === "perte") return false;
    return line.pricePoints > 0;
  });
}

export function assertCartEligibleForBuyout(detail: MemberCartOrderDetail): string | null {
  if (detail.isPurchaseOrder) return "purchase_order";
  if (String(detail.cartStatus).toLowerCase() !== "confirmed") return "cart_not_confirmed";
  const shipSt = detail.shipment?.status?.toLowerCase() ?? "";
  if (shipSt !== "delivered") return "not_delivered";
  if (isCartReturnCommitmentMet(detail.returnShipment?.status)) return "return_started";
  if (filterBuyoutEligibleLines(detail.lines).length === 0) return "no_buyable_lines";
  return null;
}

export function resolveSelectedBuyoutLines(
  detail: MemberCartOrderDetail,
  cartItemIds: readonly string[],
): { ok: true; lines: BuyoutEligibleLine[] } | { ok: false; reason: string } {
  if (cartItemIds.length === 0) return { ok: false, reason: "empty_selection" };
  const eligible = filterBuyoutEligibleLines(detail.lines);
  const byId = new Map(eligible.map((l) => [l.id, l]));
  const selected: BuyoutEligibleLine[] = [];
  const seen = new Set<string>();
  for (const id of cartItemIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const line = byId.get(id);
    if (!line) return { ok: false, reason: "items_unavailable" };
    selected.push(line);
  }
  if (selected.length === 0) return { ok: false, reason: "empty_selection" };
  return { ok: true, lines: selected };
}
