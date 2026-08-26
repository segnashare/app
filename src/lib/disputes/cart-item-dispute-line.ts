/** États `cart_items.dispute_line_status` — miroir migration. */

export const CART_ITEM_DISPUTE_LINE_STATUSES = [
  "in_dispute",
  "return_to_segna",
  "lost_not_returned",
  "cleared",
] as const;

export type CartItemDisputeLineStatus = (typeof CART_ITEM_DISPUTE_LINE_STATUSES)[number];

export function isCartItemDisputeLineStatus(value: string): value is CartItemDisputeLineStatus {
  return (CART_ITEM_DISPUTE_LINE_STATUSES as readonly string[]).includes(value);
}

export function parseCartItemDisputeLineStatus(
  value: unknown,
): CartItemDisputeLineStatus | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return isCartItemDisputeLineStatus(v) ? v : null;
}

export function cartItemDisputeLineBadgeLabel(
  status: CartItemDisputeLineStatus | null | undefined,
  opts?: {
    returnCommitmentMet?: boolean;
    /** Perte vs défaut — pour pastille `in_dispute`. */
    outcomeKind?: "loss" | "defect" | null;
  },
): string | null {
  if (!status || status === "cleared") return null;
  if (status === "return_to_segna") {
    return opts?.returnCommitmentMet ? "Retour déposé" : "À renvoyer";
  }
  if (status === "lost_not_returned") return "Perte";
  if (status === "in_dispute") {
    return opts?.outcomeKind === "loss" ? "Perte" : "Défaut";
  }
  return null;
}

export function linesRequiringReturnToSegna<T extends { disputeLineStatus?: string | null }>(
  lines: readonly T[],
): T[] {
  return lines.filter((l) => l.disputeLineStatus === "return_to_segna");
}

/** Pièce déjà déclarée perdue (non-restitution) — non sélectionnable pour un nouveau litige. */
export function isCartItemDeclaredLost(
  status: CartItemDisputeLineStatus | string | null | undefined,
): boolean {
  return String(status ?? "").trim() === "lost_not_returned";
}

export function selectableCartItemIdsForDispute<
  T extends { itemId: string; disputeLineStatus?: string | null },
>(lines: readonly T[]): string[] {
  return lines.filter((l) => !isCartItemDeclaredLost(l.disputeLineStatus)).map((l) => l.itemId);
}
