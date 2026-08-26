/**
 * Panier entièrement perdu / volé : toutes les lignes actives sont
 * `lost_not_returned`. Après facturation + clôture → historique membre.
 */

export function isCartTotalLossFromLineStatuses(
  lineStatuses: ReadonlyArray<string | null | undefined>,
): boolean {
  if (lineStatuses.length === 0) return false;
  return lineStatuses.every((s) => String(s ?? "").trim() === "lost_not_returned");
}

export function isCartTotalLossHistoryCart(input: {
  cartStatus: string | null | undefined;
  lineStatuses: ReadonlyArray<string | null | undefined>;
  hasOpenDispute?: boolean;
}): boolean {
  if (input.hasOpenDispute) return false;
  if (!isCartTotalLossFromLineStatuses(input.lineStatuses)) return false;
  const st = String(input.cartStatus ?? "").toLowerCase();
  // Archivé (chemin nominal) ou confirmed résiduel (anciennes clôtures).
  return st === "archived" || st === "confirmed";
}
