/** Libellés phase logistique (expédition aller panier) — cohérents bandeau Échange + liste « En cours ». */
export type MemberOutboundShipmentPhaseCopy = {
  title: string;
  detail: string;
  pulse?: boolean;
};

export function getMemberOutboundShipmentPhaseCopy(status: string): MemberOutboundShipmentPhaseCopy {
  switch (status) {
    case "pending":
      return {
        title: "En préparation",
        detail: "Ton colis est en cours de préparation chez Segna.",
        pulse: true,
      };
    case "ready":
      return {
        title: "Prêt à l’expédition",
        detail: "Le colis est en attente d’expédition.",
      };
    case "dropped_in":
      return {
        title: "Colis déposé",
        detail: "Segna a déposé le colis chez le partenaire d’expédition (point relais ou prise en charge).",
      };
    case "dropped_out":
      return {
        title: "Ton dépôt relais est enregistré",
        detail: "Tu as déposé le colis retour au point relais — engagement de délai respecté.",
      };
    case "in_transit_in":
      return {
        title: "En route vers toi",
        detail: "Ton colis est en transit. Suis-le avec le numéro de suivi et confirme la réception à réception.",
      };
    case "in_transit_out":
      return {
        title: "Retour en transit",
        detail: "Un colis retour est en route vers Segna.",
      };
    case "delivered":
      return {
        title: "Reçu",
        detail: "Le transporteur confirme la réception du colis. Vérifie tes pièces et signale un souci depuis l’app si besoin.",
      };
    case "closed":
      return { title: "Expédition terminée", detail: "Ce suivi est clos." };
    default:
      return {
        title: "Suivi commande",
        detail: "État d’expédition mis à jour par la logistique.",
      };
  }
}

/** Colis considéré « en transit » pour l’UI (ligne livraison sous la carte). */
export function isOutboundShipmentInTransit(status: string): boolean {
  const s = status.toLowerCase();
  return s === "in_transit_in" || s === "in_transit_out";
}

/**
 * Texte secondaire « livraison » sous la carte commande.
 * Aucune ligne tant que l’expédition n’est pas en transit (ou livrée / close).
 */
export function getOutboundShipmentDeliverySubtitle(
  status: string,
  updatedAtIso: string,
  formatDate: (iso: string) => string,
): string | null {
  const s = status.toLowerCase();
  if (s === "delivered" || s === "closed") {
    return `Réception effective le ${formatDate(updatedAtIso)}`;
  }
  if (isOutboundShipmentInTransit(s)) {
    return getMemberOutboundShipmentPhaseCopy(status).detail;
  }
  return null;
}
