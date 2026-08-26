/**
 * Politique litige pièce (app) — miroir backoffice pour gates / copy.
 */

export const ITEM_DISPUTE_OUTCOME_FAMILIES = ["degradation", "loss"] as const;
export type ItemDisputeOutcomeFamily = (typeof ITEM_DISPUTE_OUTCOME_FAMILIES)[number];

export const ITEM_DISPUTE_DISPOSITIONS = [
  "keep",
  "withdraw",
  "return_to_segna",
  "lost_not_returned",
] as const;
export type ItemDisputeDisposition = (typeof ITEM_DISPUTE_DISPOSITIONS)[number];

export function isItemDisputeDisposition(value: string): value is ItemDisputeDisposition {
  return (ITEM_DISPUTE_DISPOSITIONS as readonly string[]).includes(value);
}

export function itemDisputeDispositionLabel(disposition: ItemDisputeDisposition): string {
  switch (disposition) {
    case "keep":
      return "Conserver au catalogue";
    case "withdraw":
      return "Retirer du catalogue";
    case "return_to_segna":
      return "Retour anticipé vers Segna";
    case "lost_not_returned":
      return "Perdue — non retournée";
  }
}

export function outcomeFamilyFromMemberCategory(
  category: string | null | undefined,
): ItemDisputeOutcomeFamily {
  const c = String(category ?? "");
  if (
    c === "borrow_item_lost" ||
    c === "borrow_item_stolen" ||
    c === "reception_item_missing"
  ) {
    return "loss";
  }
  return "degradation";
}
