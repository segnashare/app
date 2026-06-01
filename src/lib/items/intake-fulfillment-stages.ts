/** Valeurs `item_intake.fulfillment_stage` (enum Postgres). */
export const INTAKE_FULFILLMENT_READY = "ready";
export const INTAKE_FULFILLMENT_SHIPPING = "shipping";
export const INTAKE_FULFILLMENT_IN_VERIFICATION = "in_verification";

/** Statuts retour emprunt : colis déposé / pris en charge (membre → Segna). */
export const CART_RETURN_INTAKE_DEPOSITED_STATUSES = new Set(["dropped_out", "dropped_in"]);

export function normalizeIntakeFulfillmentStage(fs: string | null | undefined): string {
  return String(fs ?? "").trim().toLowerCase();
}

/** Peut accéder au bordereau / portail / mutualisation (annonce validée, pas encore reçue Segna). */
export function intakeAllowsShippingPreparation(fs: string | null | undefined): boolean {
  const s = normalizeIntakeFulfillmentStage(fs);
  if (!s) return true;
  return s === INTAKE_FULFILLMENT_READY || s === INTAKE_FULFILLMENT_SHIPPING;
}

/** Carte « Préparer ton envoi » sur fiche pièce / Échange (validated + ready/shipping ou legacy null). */
export function intakeShowsPrepareShipmentCard(
  listingStage: string | null | undefined,
  fs: string | null | undefined,
): boolean {
  if (String(listingStage ?? "").trim().toLowerCase() !== "validated") return false;
  const s = normalizeIntakeFulfillmentStage(fs);
  return s === INTAKE_FULFILLMENT_READY || s === INTAKE_FULFILLMENT_SHIPPING || s === "";
}

/** Éligible à confirmer une mutualisation retour (avant dépôt effectif). */
export function intakeEligibleForPiggybackLink(fs: string | null | undefined): boolean {
  const s = normalizeIntakeFulfillmentStage(fs);
  return !s || s === INTAKE_FULFILLMENT_READY || s === INTAKE_FULFILLMENT_SHIPPING;
}

export function cartReturnStatusDeposited(returnStatus: string): boolean {
  return CART_RETURN_INTAKE_DEPOSITED_STATUSES.has(returnStatus.toLowerCase());
}
