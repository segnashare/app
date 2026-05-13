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
        title: "Colis en transit",
        detail: "Ton colis est pris en charge par le partenaire (transport vers le point relais). Suis l’envoi via le partenaire ; tu seras informée quand le retrait sera possible.",
      };
    case "dropped_out":
      return {
        title: "Colis disponible au relais",
        detail: "Tu peux retirer ton colis au point relais — suivi et consignes dans l’app (lien partenaire).",
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
        title: "Réception de commande",
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
 * @param receptionAtIso Date affichée pour « Réception effective » : `delivered_at` ou repli `updated_at`.
 */
export function getOutboundShipmentDeliverySubtitle(
  status: string,
  receptionAtIso: string,
  formatDate: (iso: string) => string,
): string | null {
  const s = status.toLowerCase();
  if (s === "delivered" || s === "closed") {
    return `Réception effective le ${formatDate(receptionAtIso)}`;
  }
  if (isOutboundShipmentInTransit(s)) {
    return getMemberOutboundShipmentPhaseCopy(status).detail;
  }
  return null;
}
