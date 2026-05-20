/**
 * Statuts logistiques `shipments.context = cart_return` (membre → relais → Segna).
 * Ne pas confondre avec l’aller (`cart_outbound`) : pas de `delivered` ni de `in_transit_in` côté retour.
 */

/** Chaîne d’avancement Sendcloud / RPC pour un retour panier. */
export const CART_RETURN_STATUS_FORWARD = [
  "pending",
  "ready",
  "dropped_out",
  "in_transit_out",
  "dropped_in",
  "returned",
  "en_verification",
  "return_validated",
  "closed",
] as const;

export type CartReturnShipmentStatus = (typeof CART_RETURN_STATUS_FORWARD)[number];

/** Valeurs héritées ou erreurs de contexte — repliées sur la chaîne retour. */
const LEGACY_ALIASES: Record<string, CartReturnShipmentStatus> = {
  delivered: "returned",
  in_transit: "in_transit_out",
  in_transit_in: "in_transit_out",
};

/**
 * Normalise un statut lu en base pour un shipment `cart_return`.
 * `delivered` et `in_transit_in` viennent de l’aller ou d’anciennes lignes : on les mappe sur la chaîne retour.
 */
export function normalizeCartReturnShipmentStatus(
  status: string | null | undefined,
): CartReturnShipmentStatus | null {
  if (!status || !String(status).trim()) return null;
  const s = String(status).trim().toLowerCase();
  const aliased = LEGACY_ALIASES[s];
  if (aliased) return aliased;
  if ((CART_RETURN_STATUS_FORWARD as readonly string[]).includes(s)) {
    return s as CartReturnShipmentStatus;
  }
  return null;
}

/** Dépôt au relais enregistré (`dropped_out`) ou étape suivante vers Segna. */
export function isCartReturnCommitmentMet(status: string | null | undefined): boolean {
  const s = normalizeCartReturnShipmentStatus(status);
  if (!s) return false;
  return (
    s === "dropped_out" ||
    s === "in_transit_out" ||
    s === "dropped_in" ||
    s === "returned" ||
    s === "en_verification" ||
    s === "return_validated" ||
    s === "closed"
  );
}

/** Liste Échange onglet Historique : dès le dépôt relais (`dropped_out`). */
export function isReturnExchangeFinishedForMemberList(status: string | null | undefined): boolean {
  const s = normalizeCartReturnShipmentStatus(status);
  if (!s) return false;
  return (
    s === "dropped_out" ||
    s === "in_transit_out" ||
    s === "dropped_in" ||
    s === "returned" ||
    s === "en_verification" ||
    s === "return_validated" ||
    s === "closed"
  );
}

export function isReturnShipmentPreDeposit(status: string | null | undefined): boolean {
  const s = normalizeCartReturnShipmentStatus(status);
  if (!s) return true;
  return s === "pending" || s === "ready";
}

/** Après dépôt relais : plus de nouveau bordereau / reset portail selon les règles métier. */
export const CART_RETURN_LOCKED_FOR_MEMBER_SETUP = new Set<CartReturnShipmentStatus>([
  "dropped_out",
  "in_transit_out",
  "dropped_in",
  "returned",
  "en_verification",
  "return_validated",
  "closed",
]);

export function isCartReturnLockedForMemberSetup(status: string | null | undefined): boolean {
  const s = normalizeCartReturnShipmentStatus(status);
  return Boolean(s && CART_RETURN_LOCKED_FOR_MEMBER_SETUP.has(s));
}
