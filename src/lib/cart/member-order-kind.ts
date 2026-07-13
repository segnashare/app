/** Type de commande membre affiché dans l’onglet Commandes. */
export type MemberOrderKind = "location" | "achat";

export function memberOrderKindLabel(kind: MemberOrderKind): string {
  return kind === "achat" ? "Achat" : "Location";
}

/** Libellé liste commandes : « Location 7j », « Location 30j », « Achat ». */
export function memberOrderTypeLabel(
  kind: MemberOrderKind,
  checkoutBorrowDurationDays?: number | null,
): string {
  if (kind === "achat") return "Achat";
  const days =
    checkoutBorrowDurationDays != null &&
    Number.isFinite(Number(checkoutBorrowDurationDays)) &&
    Number(checkoutBorrowDurationDays) >= 1
      ? Math.trunc(Number(checkoutBorrowDurationDays))
      : 30;
  return `Location ${days}j`;
}

/** Panier confirmé / archivé : achat si `checkout_purchase_mode` ou facture achat Guest. */
export function resolveMemberOrderKindFromCart(order: {
  status?: string | null;
  checkout_purchase_mode?: boolean | null;
  guest_purchase_stripe_invoice_id?: string | null;
  cart_order_stripe_invoices?:
    | { guest_purchase_stripe_invoice_id?: string | null }
    | { guest_purchase_stripe_invoice_id?: string | null }[]
    | null;
}): MemberOrderKind {
  if (order.checkout_purchase_mode === true) return "achat";
  if (
    typeof order.guest_purchase_stripe_invoice_id === "string" &&
    order.guest_purchase_stripe_invoice_id.trim()
  ) {
    return "achat";
  }
  const nested = order.cart_order_stripe_invoices;
  const invoiceRow = Array.isArray(nested) ? nested[0] : nested;
  if (
    typeof invoiceRow?.guest_purchase_stripe_invoice_id === "string" &&
    invoiceRow.guest_purchase_stripe_invoice_id.trim()
  ) {
    return "achat";
  }
  return "location";
}
