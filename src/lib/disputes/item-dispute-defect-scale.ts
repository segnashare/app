/** Barème litige pièce — aligné backoffice `item-dispute-defect-scale.ts`. */

export const ITEM_DISPUTE_DEFECT_TIERS = [
  "minor",
  "small_irreversible",
  "major_irreversible",
  "non_return",
] as const;

export type ItemDisputeDefectTier = (typeof ITEM_DISPUTE_DEFECT_TIERS)[number];

export function isItemDisputeDefectTier(value: string): value is ItemDisputeDefectTier {
  return (ITEM_DISPUTE_DEFECT_TIERS as readonly string[]).includes(value);
}

export function itemDisputeDefectTierLabel(tier: ItemDisputeDefectTier): string {
  switch (tier) {
    case "minor":
      return "Défaut minime";
    case "small_irreversible":
      return "Petit défaut irréversible";
    case "major_irreversible":
      return "Gros défaut irréversible";
    case "non_return":
      return "Non restitution";
  }
}

export function itemDisputeDefectBillingPercent(tier: ItemDisputeDefectTier): number {
  switch (tier) {
    case "minor":
      return 0;
    case "small_irreversible":
      return 30;
    case "major_irreversible":
      return 50;
    case "non_return":
      return 100;
  }
}

export function formatItemDisputePointsEuros(points: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, points),
  );
}
