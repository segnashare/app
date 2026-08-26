/**
 * Typologie des litiges panier — dossier ops / chat.
 * Les litiges pièce (`item_disputes`) portent l’économie + la disposition.
 */

export const CART_DISPUTE_KINDS = [
  "member_location",
  "member_reception",
  "member_borrow",
  "return_intake",
  "borrow_overdue",
  "intake_refusal",
  "other",
] as const;

export type CartDisputeKind = (typeof CART_DISPUTE_KINDS)[number];

export function isCartDisputeKind(value: string): value is CartDisputeKind {
  return (CART_DISPUTE_KINDS as readonly string[]).includes(value);
}

export function cartDisputeKindFromReason(reason: string | null | undefined): CartDisputeKind {
  const r = String(reason ?? "").trim();
  switch (r) {
    case "member_location_report":
      return "member_location";
    case "member_reception_report":
      return "member_reception";
    case "member_borrow_report":
      return "member_borrow";
    case "return_arrival_defect":
      return "return_intake";
    case "borrow_overdue_escalation":
    case "borrow_return_overdue_escalation":
      return "borrow_overdue";
    case "item_refused_fulfillment":
      return "intake_refusal";
    default:
      if (r.startsWith("borrow_overdue") || r.startsWith("borrow_return_overdue")) {
        return "borrow_overdue";
      }
      if (r.includes("refused_fulfillment")) return "intake_refusal";
      return "other";
  }
}

/** Dossier retard / pénalités — distinct des litiges pièce (perte, défaut retour, etc.). */
export function isBorrowOverdueCartDispute(
  reason: string | null | undefined,
  category?: string | null | undefined,
): boolean {
  if (cartDisputeKindFromReason(reason) === "borrow_overdue") return true;
  const c = String(category ?? "").trim();
  return c === "borrow_return_late" || c.endsWith(":borrow_return_late");
}

export function cartDisputeKindLabel(kind: CartDisputeKind): string {
  switch (kind) {
    case "member_location":
      return "Litige location (membre)";
    case "member_reception":
      return "Litige réception (membre)";
    case "member_borrow":
      return "Litige emprunt (membre)";
    case "return_intake":
      return "Contrôle retour (BO)";
    case "borrow_overdue":
      return "Retard / non-restitution";
    case "intake_refusal":
      return "Refus intake propriétaire";
    default:
      return "Litige";
  }
}

/** Timing métier pour les règles disposition / location qui continue. */
export type CartDisputeTiming = "mid_rental" | "member_reception" | "return_intake" | "other";

export function cartDisputeTiming(kind: CartDisputeKind): CartDisputeTiming {
  switch (kind) {
    case "member_location":
    case "member_borrow":
      return "mid_rental";
    case "member_reception":
      return "member_reception";
    case "return_intake":
      return "return_intake";
    default:
      return "other";
  }
}

/**
 * Le panier doit-il passer en `disputed` à l’ouverture ?
 * Réception membre (faute Segna) : non — location / retour BO : oui.
 */
export function shouldMarkCartDisputedOnOpen(kind: CartDisputeKind): boolean {
  return kind === "member_location" || kind === "member_borrow" || kind === "return_intake";
}

/**
 * Après traitement des pièces, peut-on remettre le panier en `confirmed`
 * pour laisser la location des autres pièces continuer ?
 */
export function shouldReleaseCartToConfirmedWhenItemsSettled(kind: CartDisputeKind): boolean {
  return kind === "member_location" || kind === "member_borrow";
}
