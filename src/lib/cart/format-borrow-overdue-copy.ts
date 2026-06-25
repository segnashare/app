import { borrowOverdueRateBps } from "@/lib/emprunt/borrow-overdue-penalty";
import { BORROW_FORMAL_NOTICE_DEADLINE_DAYS } from "@/lib/emprunt/borrow-overdue-recovery-policy";

export const BORROW_OVERDUE_CG_LOCATION_HREF = "https://www.segnashare.com/conditions-location";

function sanitizeLateDayIndex(lateDayIndex: number): number {
  return Math.max(1, Math.trunc(lateDayIndex));
}

export function borrowOverdueRatePercent(lateDayIndex: number): number {
  return Math.round(borrowOverdueRateBps(sanitizeLateDayIndex(lateDayIndex)) / 100);
}

/** Compteur : « 1 jour », « 5 jours ». */
export function formatBorrowOverdueDayCountFr(lateDayIndex: number): string {
  const d = sanitizeLateDayIndex(lateDayIndex);
  return d === 1 ? "1 jour" : `${d} jours`;
}

/** Carte liste / méta : « 1 jour de retard », « 5 jours de retard ». */
export function formatBorrowOverdueDaysLabelFr(lateDayIndex: number): string {
  const d = sanitizeLateDayIndex(lateDayIndex);
  return d === 1 ? "1 jour de retard" : `${d} jours de retard`;
}

/** Titre modale blocage (une ligne), selon phase recovery. */
export function formatBorrowOverdueHeadlineFr(
  lateDayIndex: number,
  opts?: {
    escalated?: boolean;
    formalNoticeSent?: boolean;
    formalNoticeDeadlinePassed?: boolean;
  },
): string {
  const d = sanitizeLateDayIndex(lateDayIndex);
  const dayPart = d === 1 ? "1 jour" : `${d} jours`;
  const parts = ["Retour en retard", dayPart];

  if (opts?.formalNoticeDeadlinePassed) {
    parts.push("Délai de restitution dépassé");
  } else if (opts?.formalNoticeSent) {
    parts.push("Mise en demeure");
  } else if (opts?.escalated) {
    parts.push("Dossier transmis");
  }

  return parts.join(" · ");
}

/** @deprecated Préférer {@link formatBorrowOverdueHeadlineFr} (titre sur une ligne). */
export function formatBorrowOverdueHeadlineLinesFr(
  lateDayIndex: number,
  opts?: { escalated?: boolean },
): string[] {
  const d = sanitizeLateDayIndex(lateDayIndex);
  const lines = ["Retour en retard", d === 1 ? "1er jour" : `${d} jours`];
  if (opts?.escalated) lines.push("Dossier transmis");
  return lines;
}

/** Lignes commande + retard (bandeau Échange). */
export function formatBorrowOverdueOrderLinesFr(orderNumberCompact: string, lateDayIndex: number): string[] {
  return [`Commande ${orderNumberCompact}`, formatBorrowOverdueDaysLabelFr(lateDayIndex)];
}

/** Taux du jour. */
export function formatBorrowOverdueDailyRateLinesFr(_lateDayIndex: number): string[] {
  return ["3 % de la valeur de ton panier par jour."];
}

/** Rappel taux (feuille « En savoir plus », J-J). */
export function formatBorrowOverdueRateTiersSummaryLinesFr(): string[] {
  return ["3 % de la valeur du panier par jour, tant que le retour n'est pas effectué."];
}

/** Intro pénalités (1ʳᵉ ligne + taux). */
export function formatBorrowOverduePenaltyIntroLinesFr(lateDayIndex: number): string[] {
  return ["Des pénalités journalières s'appliquent.", ...formatBorrowOverdueDailyRateLinesFr(lateDayIndex)];
}

/** Corps bandeau Échange. */
export function formatBorrowOverdueBannerBodyLinesFr(lateDayIndex: number): string[] {
  return [
    ...formatBorrowOverduePenaltyIntroLinesFr(lateDayIndex),
    "Chaque jour de retard est prélevé sur ta carte enregistrée.",
    "Dépose ton colis au relais pour stopper l'accumulation.",
    "Tu peux aussi prolonger l'échange si tu en as encore la possibilité.",
  ];
}

/** Corps modale blocage app J+1 (layout `(main)`). */
export function formatBorrowOverdueAppGateModalIntroFr(lateDayIndex: number): string {
  return `Ton retour est en retard depuis ${formatBorrowOverdueDayCountFr(lateDayIndex)}.`;
}

export function formatBorrowOverdueAppGateModalPenaltyChargePrefixFr(): string {
  return "Des pénalités journalières s'appliquent et sont prélevées automatiquement";
}

export const BORROW_OVERDUE_CG_LOCATION_LABEL_FR = "Conditions générales de location";

/** @deprecated Préférer prefix + lien inline dans la modale. */
export function formatBorrowOverdueAppGateModalPenaltyChargeFr(_lateDayIndex: number): string {
  return formatBorrowOverdueAppGateModalPenaltyChargePrefixFr();
}

export function formatBorrowOverdueAppGateModalNonRestitutionDeadlineFr(opts: {
  deadlineLabel: string;
}): string {
  return `Sans retour déposé, la valeur du panier pourra être exigée au plus tard le ${opts.deadlineLabel}`;
}

export type BorrowOverdueAppGateDeadlineCallout = {
  title: string;
  body: string;
  /** Lien CG inline en fin de paragraphe (« Conditions générales de location »). */
  inlineCgLink?: boolean;
  tone: "neutral" | "warning" | "urgent";
};

/** Montant € affiché pour la valeur de remplacement / panier. */
export function formatBorrowOverdueEurosFr(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}

/** Encart délai restitution / facturation panier (modale blocage). */
export function formatBorrowOverdueAppGateModalDeadlineCallout(opts: {
  deadlineLabel: string;
  deadlineIsProjected: boolean;
  formalNoticeSent: boolean;
  formalNoticeDeadlinePassed: boolean;
  formalNoticeDeadlineLabel: string | null;
  cartValueCents: number;
}): BorrowOverdueAppGateDeadlineCallout {
  const medDeadline = opts.formalNoticeDeadlineLabel ?? opts.deadlineLabel;
  const replacementValueLabel = formatBorrowOverdueEurosFr(opts.cartValueCents);

  if (opts.formalNoticeDeadlinePassed) {
    return {
      title: "Facturation de la valeur du panier",
      body: `Le délai de restitution fixé par la mise en demeure (${medDeadline}) est dépassé. Sans retour déposé, la valeur du panier et les frais prévus aux conditions générales pourront être exigés.`,
      tone: "urgent",
    };
  }

  if (opts.formalNoticeSent) {
    return {
      title: `Restitue ta box avant le ${medDeadline}`,
      body: `Une mise en demeure t'a été adressée. Tu disposes de ${BORROW_FORMAL_NOTICE_DEADLINE_DAYS} jours pour déposer ton colis au relais. Passé cette date, la valeur de remplacement du panier : ${replacementValueLabel}, te\u00A0sera\u00A0facturée.`,
      inlineCgLink: true,
      tone: "warning",
    };
  }

  if (opts.deadlineIsProjected) {
    return {
      title: `Échéance indicative : ${opts.deadlineLabel}`,
      body: "Sans retour déposé, une mise en demeure pourra t'être adressée, puis la valeur du panier pourra être exigée. Cette date est une estimation selon le calendrier prévu par nos conditions générales.",
      tone: "neutral",
    };
  }

  return {
    title: `Au plus tard le ${opts.deadlineLabel}`,
    body: "Sans retour déposé, la valeur du panier pourra être exigée conformément aux conditions générales de location.",
    tone: "warning",
  };
}

export function formatBorrowOverdueAppGateModalActionNoteFr(opts?: {
  formalNoticeSent?: boolean;
  formalNoticeDeadlinePassed?: boolean;
}): string {
  if (opts?.formalNoticeDeadlinePassed) {
    return "Dépose ton colis au relais dès que possible ou contacte l'assistance si tu rencontres un problème.";
  }
  if (opts?.formalNoticeSent) {
    return "Dépose ton colis au relais avant la date indiquée pour éviter la facturation de la valeur du panier.";
  }
  return "Dépose ton colis au relais ou prolonge l'échange depuis ta page emprunt pour stopper les pénalités.";
}

/** @deprecated Préférer les helpers structurés ci-dessus + JSX dans la modale. */
export function formatBorrowOverdueAppGateModalBodyLinesFr(lateDayIndex: number): string[] {
  return [
    formatBorrowOverdueAppGateModalIntroFr(lateDayIndex),
    formatBorrowOverdueAppGateModalPenaltyChargeFr(lateDayIndex),
    formatBorrowOverdueAppGateModalActionNoteFr(),
  ];
}

/** Libellé statut prélèvement (liste historique modale). */
export function formatBorrowOverdueChargeDayStatusFr(chargeStatus: string): string {
  switch (chargeStatus) {
    case "charged":
      return "Prélevé";
    case "failed":
      return "Non prélevé";
    case "pending":
    default:
      return "En attente";
  }
}

export function formatBorrowOverdueAppGateChargeHistoryTitleFr(): string {
  return "Frais de retard";
}

/** Sous-titre du dépliant (fermé) : synthèse montants. */
export function formatBorrowOverdueAppGateChargeHistoryTeaserFr(opts: {
  chargedCents: number;
  unpaidCents: number;
  hasFailedCharge: boolean;
  showStripeSettlement: boolean;
}): string {
  const parts: string[] = [];
  if (opts.chargedCents > 0) {
    parts.push(`${formatBorrowOverdueEurosFr(opts.chargedCents)} prélevé`);
  }
  if (opts.unpaidCents > 0) {
    if (opts.showStripeSettlement) {
      parts.push(`${formatBorrowOverdueEurosFr(opts.unpaidCents)} à régler`);
    } else {
      parts.push(`${formatBorrowOverdueEurosFr(opts.unpaidCents)} en attente`);
    }
  }
  if (opts.hasFailedCharge && !opts.showStripeSettlement && opts.unpaidCents > 0) {
    parts.push("carte à mettre à jour");
  }
  return parts.length > 0 ? parts.join(" · ") : "Aucun prélèvement pour l'instant";
}

export function formatBorrowOverdueAppGateChargeHistoryPendingNoteFr(): string {
  return "Les pénalités s'accumulent jusqu'au minimum Stripe de 0,50 € avant prélèvement automatique.";
}

export function formatBorrowOverdueAppGateChargeHistorySettleLabelFr(): string {
  return "Lien paiement";
}

/** Rappel compact fiche emprunt (sous les CTA). */
export function formatBorrowOverdueEmpruntCompactTitleFr(): string {
  return "Ton retour est en retard";
}

export function formatBorrowOverdueEmpruntCompactBodyLinesFr(totalPenaltyCents: number): [string, string] {
  const total = formatBorrowOverdueEurosFr(totalPenaltyCents);
  return ["Des frais de retard sont en cours.", `Total à ce jour : ${total}.`];
}

/** Corps bloc emprunt détaillé (modale / feuille « en savoir plus »). */
export function formatBorrowOverdueEmpruntBodyLinesFr(lateDayIndex: number): string[] {
  return [
    ...formatBorrowOverduePenaltyIntroLinesFr(lateDayIndex),
    "Chaque jour de retard est prélevé automatiquement sur ta carte enregistrée (minimum Stripe 0,50 € par prélèvement).",
    "Tant que ton colis n'est pas déposé au relais, les pénalités continuent de s'accumuler.",
  ];
}

/** Alerte prélèvement carte refusé. */
export function formatBorrowOverdueFailedChargeLinesFr(): string[] {
  return [
    "Un prélèvement sur ta carte n'a pas abouti.",
    "Mets à jour ton moyen de paiement pour régulariser la situation.",
  ];
}

/** J+14 : escalade possible. */
export function formatBorrowOverdueEscalationHintLinesFr(lateDayIndex: number): string[] | null {
  if (sanitizeLateDayIndex(lateDayIndex) < 14) return null;
  return [
    "Au-delà de 14 jours sans retour déposé au relais, ton dossier peut être transmis à notre équipe.",
    "Contacte le support si tu as besoin d'aide.",
  ];
}

export type BorrowOverdueChargeFailureReason =
  | "below_stripe_minimum"
  | "no_payment_method"
  | "card_declined";

export function mapBorrowOverdueSettleErrorToChargeContext(opts: {
  chargeStatus: string;
  settleError?: string | null;
}): {
  chargeStatus: "charged" | "pending" | "failed";
  chargeFailureReason?: BorrowOverdueChargeFailureReason;
} {
  if (opts.chargeStatus === "charged") {
    return { chargeStatus: "charged" };
  }

  const err = String(opts.settleError ?? "").trim();
  if (err === "amount_below_stripe_minimum") {
    return { chargeStatus: "pending", chargeFailureReason: "below_stripe_minimum" };
  }
  if (err === "no_payment_method" || err === "no_billing_customer" || err === "customer_deleted") {
    return { chargeStatus: "failed", chargeFailureReason: "no_payment_method" };
  }
  if (opts.chargeStatus === "failed" || err.length > 0) {
    return { chargeStatus: "failed", chargeFailureReason: "card_declined" };
  }
  if (opts.chargeStatus === "pending") {
    return { chargeStatus: "pending", chargeFailureReason: "below_stripe_minimum" };
  }
  return { chargeStatus: "pending" };
}

function formatPenaltyEurosLabelFr(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    Math.max(0, cents) / 100,
  );
}

/** E-mail / SMS : statut de prélèvement du jour (montant + cause si non prélevé). */
export function formatBorrowOverdueDailyChargeNoteLinesFr(opts: {
  penaltyCents: number;
  lateDayIndex: number;
  ratePercent: number;
  chargeStatus: string;
  chargeFailureReason?: BorrowOverdueChargeFailureReason;
}): string[] {
  const day = sanitizeLateDayIndex(opts.lateDayIndex);
  const dayLabel = day === 1 ? "1er jour de retard" : `${day}e jour de retard`;
  const amountLabel = formatPenaltyEurosLabelFr(opts.penaltyCents);
  const penaltyLine = `Aujourd'hui, la pénalité est de ${opts.ratePercent} % de la valeur de ton panier, soit ${amountLabel} pour ce ${dayLabel}.`;

  const ctx = mapBorrowOverdueSettleErrorToChargeContext({
    chargeStatus: opts.chargeStatus,
    settleError:
      opts.chargeFailureReason === "below_stripe_minimum"
        ? "amount_below_stripe_minimum"
        : opts.chargeFailureReason === "no_payment_method"
          ? "no_payment_method"
          : opts.chargeFailureReason === "card_declined"
            ? "payment_failed"
            : null,
  });

  if (ctx.chargeStatus === "charged") {
    return [penaltyLine, "Ce montant a été prélevé sur ta carte enregistrée."];
  }
  if (ctx.chargeFailureReason === "below_stripe_minimum") {
    return [
      penaltyLine,
      "Prélèvement différé : les pénalités s'accumulent jusqu'au minimum Stripe de 0,50 €.",
    ];
  }
  if (ctx.chargeFailureReason === "no_payment_method") {
    return [
      penaltyLine,
      "Nous n'avons pas pu prélever ce montant : aucune carte n'est enregistrée sur ton compte.",
    ];
  }
  return [
    penaltyLine,
    "Nous n'avons pas pu prélever ce montant : le prélèvement sur ta carte n'a pas abouti.",
  ];
}

/** SMS : clause courte après le montant (limite de caractères). */
export function formatBorrowOverdueDailySmsChargeClauseFr(opts: {
  chargeStatus: string;
  chargeFailureReason?: BorrowOverdueChargeFailureReason;
}): string {
  const ctx = mapBorrowOverdueSettleErrorToChargeContext({
    chargeStatus: opts.chargeStatus,
    settleError:
      opts.chargeFailureReason === "below_stripe_minimum"
        ? "amount_below_stripe_minimum"
        : opts.chargeFailureReason === "no_payment_method"
          ? "no_payment_method"
          : opts.chargeFailureReason === "card_declined"
            ? "payment_failed"
            : null,
  });

  if (ctx.chargeStatus === "charged") {
    return "Prélevé sur ta carte.";
  }
  if (ctx.chargeFailureReason === "below_stripe_minimum") {
    return "Non prélevé (cumul min. 0,50 €).";
  }
  if (ctx.chargeFailureReason === "no_payment_method") {
    return "Non prélevé (carte absente).";
  }
  return "Non prélevé (carte refusée).";
}

/** Email : rappel taux fixe 3 %. */
export function formatBorrowOverdueEmailTierNoteLinesFr(_lateDayIndex: number): string[] {
  return ["La pénalité est de 3 % de la valeur de ton panier par jour."];
}

/** Objet e-mail retard quotidien. */
export function formatBorrowOverdueEmailSubjectFr(lateDayIndex: number): string {
  const d = sanitizeLateDayIndex(lateDayIndex);
  return d === 1 ? "Retour en retard, 1er jour de pénalité" : `Retour en retard, ${d} jours`;
}

/** Corps e-mail retard (texte brut, lignes séparées par \\n). */
export function formatBorrowOverdueEmailBodyLinesFr(opts: {
  lateDayIndex: number;
  cartLabel: string;
  chargeNoteLines: string[];
  tierLines: string[];
}): string[] {
  const day = sanitizeLateDayIndex(opts.lateDayIndex);
  const orderRef = opts.cartLabel.replace(/^Commande\s+/i, "").trim();
  return [
    `Ton emprunt ${orderRef} a ${formatBorrowOverdueDayCountFr(day)} de retard par rapport à la date de retour prévue.`,
    ...opts.chargeNoteLines,
    ...opts.tierLines,
    "Dès que tu déposes ton colis au relais, les pénalités cessent de s'accumuler.",
    "Si tu as besoin de plus de temps, tu peux aussi prolonger ton échange depuis l'app.",
  ];
}

/** E-mail : lien régularisation Stripe ou ajout de carte. */
export function formatBorrowOverdueEmailSettlementParagraphFr(opts: {
  regulariserUrl?: string | null;
  profilePaymentUrl?: string | null;
}): { text: string; html: string } | null {
  const stripeUrl = opts.regulariserUrl?.trim();
  if (stripeUrl) {
    return {
      text: `Ajoute un moyen de paiement pour régulariser la situation et éviter de nouveaux échecs de prélèvement : ${stripeUrl}`,
      html: `Ajoute un moyen de paiement pour régulariser la situation et éviter de nouveaux échecs de prélèvement. <a href="${stripeUrl}" style="color:#2563eb;text-decoration:underline;">Régulariser via Stripe</a>`,
    };
  }
  const profileUrl = opts.profilePaymentUrl?.trim();
  if (profileUrl) {
    return {
      text: `Ajoute un moyen de paiement dans l'app pour les prochains prélèvements automatiques : ${profileUrl}`,
      html: `Ajoute un moyen de paiement dans l'app pour les prochains prélèvements automatiques. <a href="${profileUrl}" style="color:#2563eb;text-decoration:underline;">Mon profil</a>`,
    };
  }
  return null;
}
