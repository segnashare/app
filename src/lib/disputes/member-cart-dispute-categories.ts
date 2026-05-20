/** Problèmes pendant l’emprunt — situation côté membre. */
export const MEMBER_BORROW_DISPUTE_CATEGORIES = [
  { id: "borrow_item_lost", label: "Perte de la pièce pendant l'emprunt" },
  { id: "borrow_item_damaged", label: "Pièce abîmée ou détériorée" },
  { id: "borrow_item_stolen", label: "Vol ou disparition suspectée" },
  { id: "borrow_return_late", label: "Retard pour renvoyer la box" },
  { id: "borrow_return_relay", label: "Difficulté au dépôt retour (relais, étiquette)" },
  { id: "borrow_accident", label: "Accident ou événement imprévu" },
  { id: "borrow_other", label: "Autre situation" },
] as const;

/** Problèmes à la réception (J+0) — colis, contenu, conformité, livraison Segna. */
export const MEMBER_RECEPTION_DISPUTE_CATEGORIES = [
  { id: "reception_package", label: "Colis endommagé, ouvert ou incomplet" },
  { id: "reception_item_missing", label: "Article manquant dans le colis" },
  { id: "reception_item_damaged", label: "Pièce abîmée à la réception" },
  { id: "reception_not_conforming", label: "Pièce non conforme à l'annonce" },
  { id: "reception_outbound_late", label: "Livraison aller en retard ou non reçue" },
  { id: "reception_wrong_item", label: "Mauvais article reçu" },
  { id: "reception_other", label: "Autre problème à la réception" },
] as const;

export type MemberBorrowDisputeCategoryId = (typeof MEMBER_BORROW_DISPUTE_CATEGORIES)[number]["id"];
export type MemberReceptionDisputeCategoryId = (typeof MEMBER_RECEPTION_DISPUTE_CATEGORIES)[number]["id"];
export type MemberCartDisputeCategoryId = MemberBorrowDisputeCategoryId | MemberReceptionDisputeCategoryId;

export type MemberCartDisputeReportKind = "borrow" | "reception";

/** @deprecated Alias historique — utiliser `MemberCartDisputeReportKind`. */
export type MemberCartDisputeReportContext = MemberCartDisputeReportKind;

const BORROW_IDS = new Set<string>(MEMBER_BORROW_DISPUTE_CATEGORIES.map((c) => c.id));
const RECEPTION_IDS = new Set<string>(MEMBER_RECEPTION_DISPUTE_CATEGORIES.map((c) => c.id));

/** @deprecated Utiliser MEMBER_BORROW_DISPUTE_CATEGORIES. */
export const MEMBER_CART_DISPUTE_CATEGORIES = MEMBER_BORROW_DISPUTE_CATEGORIES;

/** @deprecated Utiliser MEMBER_RECEPTION_DISPUTE_CATEGORIES. */
export const MEMBER_CART_DISPUTE_SEGNA_FAULT_AT_RECEPTION_CATEGORIES = MEMBER_RECEPTION_DISPUTE_CATEGORIES;

export function isMemberBorrowDisputeCategoryId(value: string): value is MemberBorrowDisputeCategoryId {
  return BORROW_IDS.has(value);
}

export function isMemberReceptionDisputeCategoryId(value: string): value is MemberReceptionDisputeCategoryId {
  return RECEPTION_IDS.has(value);
}

export function isMemberCartDisputeCategoryId(
  value: string,
  kind: MemberCartDisputeReportKind = "borrow",
): value is MemberCartDisputeCategoryId {
  return kind === "borrow" ? BORROW_IDS.has(value) : RECEPTION_IDS.has(value);
}

export function memberCartDisputeCategoriesForKind(kind: MemberCartDisputeReportKind) {
  return kind === "borrow" ? MEMBER_BORROW_DISPUTE_CATEGORIES : MEMBER_RECEPTION_DISPUTE_CATEGORIES;
}

/** @deprecated Utiliser memberCartDisputeCategoriesForKind. */
export function memberCartDisputeCategoriesForContext(context: MemberCartDisputeReportKind) {
  return memberCartDisputeCategoriesForKind(context);
}

export function memberCartDisputeCategoryLabel(
  id: string | null | undefined,
  kind?: MemberCartDisputeReportKind,
): string {
  if (!id) return "—";
  const all = kind
    ? memberCartDisputeCategoriesForKind(kind)
    : [...MEMBER_BORROW_DISPUTE_CATEGORIES, ...MEMBER_RECEPTION_DISPUTE_CATEGORIES];
  return all.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

export function memberCartDisputeReasonForKind(kind: MemberCartDisputeReportKind): string {
  return kind === "borrow" ? "member_borrow_report" : "member_reception_report";
}

export type MemberCartDisputeScope = "whole_cart" | "selected_items";

export function isMemberCartDisputeScope(value: string): value is MemberCartDisputeScope {
  return value === "whole_cart" || value === "selected_items";
}

export function resolveDisputeScopeFromSelection(
  allItemIds: string[],
  selectedItemIds: string[],
): { scope: MemberCartDisputeScope; itemIds: string[] } | { error: string } {
  if (allItemIds.length === 0) {
    return { error: "Aucun article sur cette commande." };
  }
  if (selectedItemIds.length === 0) {
    return { error: "Sélectionne au moins un article." };
  }
  if (selectedItemIds.some((id) => !allItemIds.includes(id))) {
    return { error: "Sélection d'articles invalide." };
  }
  if (selectedItemIds.length === allItemIds.length) {
    return { scope: "whole_cart", itemIds: [] };
  }
  return { scope: "selected_items", itemIds: selectedItemIds };
}
