import { formatBorrowReturnDueDateShortFr } from "@/lib/cart/cart-borrow-return-due";

/** Libellés phase logistique (expédition aller panier) — cohérents bandeau Échange + liste « En cours ». */
export type MemberOutboundShipmentPhaseCopy = {
  title: string;
  detail: string;
  pulse?: boolean;
};

/** Ancienne valeur enum `in_transit` (avant split `in_transit_in` / `in_transit_out`) — encore présente sur certaines lignes. */
export function normalizeOutboundShipmentStatusForUi(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === "in_transit") return "in_transit_in";
  return s;
}

export function getMemberOutboundShipmentPhaseCopy(status: string): MemberOutboundShipmentPhaseCopy {
  switch (normalizeOutboundShipmentStatusForUi(status)) {
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
        detail: "Ton colis est disponible en point relais. Détails et suivi sur le mail du partenaire d’expédition.",
      };
    case "in_transit_in":
      return {
        title: "En route vers toi",
        detail: "Ton colis est en chemin. Suis la livraison sur Uber jusqu’à réception.",
        pulse: true,
      };
    case "in_transit_out":
      return {
        title: "Retour en transit",
        detail: "Un colis retour est en route vers Segna.",
      };
    case "delivered":
      return {
        title: "Échange en cours",
        detail: "Confirme la bonne réception de ta commande pour accéder à ton emprunt.",
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
  const s = normalizeOutboundShipmentStatusForUi(status);
  return s === "in_transit_in" || s === "in_transit_out";
}

/**
 * Texte secondaire « livraison » sous la carte commande.
 * Aucune ligne tant que l’expédition n’est pas en transit (ou livrée / close).
 * @param receptionAtIso Repli date pour statut `closed` (`delivered_at` ou `updated_at`).
 * @param opts.borrowReturnDueMs Échéance retour pour « Retour prévu » quand livré.
 */
export function getOutboundShipmentDeliverySubtitle(
  status: string,
  receptionAtIso: string,
  formatDate: (iso: string) => string,
  opts?: { borrowReturnDueMs?: number },
): string | null {
  const s = status.toLowerCase();
  if (s === "delivered") {
    const dueMs = opts?.borrowReturnDueMs;
    if (dueMs != null && Number.isFinite(dueMs)) {
      return `Retour prévu : ${formatBorrowReturnDueDateShortFr(dueMs)}`;
    }
    return null;
  }
  if (s === "closed") {
    return `Réception effective le ${formatDate(receptionAtIso)}`;
  }
  if (isOutboundShipmentInTransit(s)) {
    return getMemberOutboundShipmentPhaseCopy(status).detail;
  }
  return null;
}
