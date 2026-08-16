/** Type de commande membre affiché dans l’onglet Commandes. */
export type MemberOrderKind = "location" | "achat";

export function memberOrderKindLabel(kind: MemberOrderKind): string {
  return kind === "achat" ? "Achat" : "Location";
}

export function exchangeComplementCentsFromCartOrder(order: {
  cart_order_stripe_invoices?:
    | { credits_line_cents?: number | null }
    | { credits_line_cents?: number | null }[]
    | null;
}): number {
  const nested = order.cart_order_stripe_invoices;
  const rows = Array.isArray(nested) ? nested : nested ? [nested] : [];
  let max = 0;
  for (const row of rows) {
    const raw = Number(row?.credits_line_cents ?? 0);
    if (!Number.isFinite(raw)) continue;
    max = Math.max(max, Math.trunc(raw));
  }
  return Math.max(0, max);
}

function resolveExchangeComplementCents(opts: {
  exchangeComplementCents?: number | null;
  exchangeComplementEuros?: number | null;
}): number {
  if (opts.exchangeComplementCents != null) {
    const raw = Number(opts.exchangeComplementCents);
    if (Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
  }
  if (opts.exchangeComplementEuros != null) {
    const raw = Number(opts.exchangeComplementEuros);
    if (Number.isFinite(raw)) return Math.max(0, Math.round(raw * 100));
  }
  return 0;
}

/** SegnaX dans le budget : pas de complément d’échange → pas de durée / échéance guest. */
export function isSegnaXLocationWithoutExchangeComplement(opts: {
  membershipLabel?: string | null;
  exchangeComplementCents?: number | null;
  exchangeComplementEuros?: number | null;
  checkoutBorrowDurationDays?: number | null;
  isPurchaseOrder?: boolean;
  /** Résiliation programmée : les locations X passent en durée limitée (échéance = fin d’abo). */
  cancelAtPeriodEnd?: boolean | null;
}): boolean {
  if (opts.isPurchaseOrder) return false;
  if (opts.cancelAtPeriodEnd) return false;
  if (opts.membershipLabel !== "Membre X") return false;
  const days =
    opts.checkoutBorrowDurationDays != null &&
    Number.isFinite(Number(opts.checkoutBorrowDurationDays)) &&
    Number(opts.checkoutBorrowDurationDays) >= 1
      ? Math.trunc(Number(opts.checkoutBorrowDurationDays))
      : null;
  // 7j / 14j = durée choisie pour un complément (jamais le défaut SegnaX à 30).
  if (days != null && days !== 30) return false;
  return resolveExchangeComplementCents(opts) <= 0;
}

/** Libellé liste commandes : « Location X », « Location 7j », « Location 30j », « Achat ». */
export function memberOrderTypeLabel(
  kind: MemberOrderKind,
  checkoutBorrowDurationDays?: number | null,
  opts?: {
    membershipLabel?: string | null;
    exchangeComplementCents?: number | null;
    cancelAtPeriodEnd?: boolean | null;
  },
): string {
  if (kind === "achat") return "Achat";
  if (
    isSegnaXLocationWithoutExchangeComplement({
      membershipLabel: opts?.membershipLabel,
      exchangeComplementCents: opts?.exchangeComplementCents,
      checkoutBorrowDurationDays,
      cancelAtPeriodEnd: opts?.cancelAtPeriodEnd,
    })
  ) {
    return "Location X";
  }
  const days =
    checkoutBorrowDurationDays != null &&
    Number.isFinite(Number(checkoutBorrowDurationDays)) &&
    Number(checkoutBorrowDurationDays) >= 1
      ? Math.trunc(Number(checkoutBorrowDurationDays))
      : null;
  if (days == null) return "Location";
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
