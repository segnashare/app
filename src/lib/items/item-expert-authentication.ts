/** Seuil prix (€ / crédits retail) pour afficher le bloc authentification expert. */
export const ITEM_EXPERT_AUTHENTICATION_MIN_PRICE = 70;

const VINTAGE_DRESSING_BRAND = "vintage dressing";

function normalizeBrandLabel(brand: string | undefined | null): string {
  return brand?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

export function shouldShowItemExpertAuthentication(
  brand: string | undefined | null,
  pricePoints: number | null | undefined,
): boolean {
  if (normalizeBrandLabel(brand) === VINTAGE_DRESSING_BRAND) return false;

  const price =
    typeof pricePoints === "number" && Number.isFinite(pricePoints) ? Math.max(0, pricePoints) : 0;
  if (price < ITEM_EXPERT_AUTHENTICATION_MIN_PRICE) return false;

  return true;
}
