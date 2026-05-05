/** Libellés suivi retour panier (`context = cart_return`) — alignés liste Échange & page dédiée. */

export type MemberReturnShipmentPhaseCopy = {
  title: string;
  detail: string;
  pulse?: boolean;
};

const RETURN_PHASE_COMPLETE = new Set(["return_validated", "closed"]);

/** True tant que le retour n’est pas clôturé côté Segna (le membre doit voir la page « suivi retour » en priorité). */
export function isActiveMemberReturnPhase(status: string | null | undefined): boolean {
  if (!status || !String(status).trim()) return false;
  return !RETURN_PHASE_COMPLETE.has(status.toLowerCase());
}

/**
 * `returned` et `en_verification` : même message côté membre (colis reçu, contrôle en cours).
 * La distinction reste en base pour le back-office.
 */
export function getMemberReturnShipmentPhaseCopy(status: string): MemberReturnShipmentPhaseCopy {
  const s = status.toLowerCase();
  switch (s) {
    case "pending":
      return {
        title: "Retour à préparer",
        detail: "Ton bordereau d’envoi vers Segna sera généré automatiquement dès que possible.",
        pulse: true,
      };
    case "ready":
      return {
        title: "Étiquette retour prête",
        detail:
          "Bordereau déjà dans la pochette d’origine ; le lien ci-dessous est un PDF de secours (optionnel). Dépose au relais indiqué.",
      };
    case "dropped_out":
      return {
        title: "Dépôt relais enregistré",
        detail: "Ton engagement sur les délais de retour est réputé respecté.",
      };
    case "in_transit_out":
      return {
        title: "Retour en transit",
        detail: "Ton colis est en route vers Segna.",
      };
    case "dropped_in":
    case "in_transit_in":
      return {
        title: "Retour en transit",
        detail: "Ton colis est pris en charge vers Segna.",
      };
    case "returned":
    case "en_verification":
      return {
        title: "Reçu chez Segna",
        detail: "Nous vérifions les pièces ; tu seras informé en cas d’écart.",
      };
    case "return_validated":
      return {
        title: "Retour validé",
        detail: "Le retour de ton emprunt est terminé côté Segna.",
      };
    case "closed":
      return {
        title: "Retour clos",
        detail: "Ce suivi retour est clos.",
      };
    case "failed":
      return {
        title: "Retour en difficulté",
        detail: "Contacte le support Segna si tu as besoin d’aide.",
        pulse: true,
      };
    default:
      return {
        title: "Suivi retour",
        detail: "État mis à jour par la logistique Segna.",
      };
  }
}

export function getReturnShipmentSubtitle(
  status: string,
  updatedAtIso: string,
  formatDate: (iso: string) => string,
): string | null {
  const s = status.toLowerCase();
  if (s === "pending" || s === "ready") return null;
  return `Dernière mise à jour le ${formatDate(updatedAtIso)}`;
}
