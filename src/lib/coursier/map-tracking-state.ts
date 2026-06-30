/** Mappe l’état Coursier vers le statut Segna `shipments`. */
export function mapCoursierStateToShipmentStatus(
  state: string,
): "in_transit_in" | "delivered" | "failed" | null {
  const s = state.trim().toLowerCase();
  if (s === "livré" || s === "livre" || s === "facturé" || s === "facture") {
    return "delivered";
  }
  if (s === "enlevé" || s === "enleve") {
    return "in_transit_in";
  }
  if (s === "annulé" || s === "annule" || s === "suspendu") {
    return "failed";
  }
  return null;
}
