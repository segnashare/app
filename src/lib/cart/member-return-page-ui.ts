import { isCartReturnMemberTrackingNumber } from "@/lib/cart/cart-return-shipment";
import { normalizeCartReturnShipmentStatus } from "@/lib/cart/cart-return-status";
import { getMemberReturnShipmentPhaseCopy, getReturnShipmentSubtitle } from "@/lib/cart/member-return-shipment-copy";
import { formatBorrowReturnDueDateShortFr, resolveCartBorrowReturnDueMs } from "@/lib/cart/cart-borrow-return-due";
import { formatDateParis } from "@/lib/datetime/segna-datetime";
import type { SegnaBorrowMembershipLabel } from "@/lib/emprunt/borrow-period";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

export type ReturnPageCta = {
  label: string;
  href: string;
  variant: "primary" | "secondary";
};

export type MemberReturnPageUi = {
  /** Lien vers la page de notation des pièces (retour initié). */
  showItemFeedbackCta?: boolean;
  itemFeedbackHref?: string;
  /** Titre principal (Playfair), aligné sur la phase logistique. */
  headerTitle: string;
  /** Sous-titre sous le H1 (commande + date). */
  metaLine: string;
  /** Grand titre sous l’œil (Montserrat), comme « Gère ton panier » sur l’emprunt. */
  heroTagline: string;
  /** Une ou deux phrases sous le hero. */
  bodyLines: string[];
  /** Affiche « En savoir plus » (délais / retard) après la dernière ligne de corps. */
  showBorrowDelayLearnMore?: boolean;
  membershipLabel?: MembershipLabel;
  ctas: ReturnPageCta[];
  /** Bouton « Imprimer mon bordereau » (portail Sendcloud au clic, avant suivi XT). */
  showReturnPrepareButton?: boolean;
  /** Lien « Retourner mon échange » vers le suivi (après création retour Sendcloud). */
  showReturnTrackingButton?: boolean;
  /** Bouton « Réinitialiser le retour » (secondaire, uniquement avec suivi XT). */
  showReturnResetButton?: boolean;
};

type Ctx = {
  cartId: string;
  orderNumberCompact: string;
  trackingNumber: string | null;
  /** Lien suivi transporteur (Sendcloud / partenaire). */
  trackingUrl?: string | null;
  labelUrl: string | null;
  updatedAtIso: string | null;
  /** Livraison aller : `shipments.delivered_at` si présent, sinon `updated_at` (legacy). */
  outboundDeliveredAtIso?: string | null;
  membershipLabel?: MembershipLabel;
  /** Échéance figée (`carts.borrow_return_due_at`). */
  borrowReturnDueAtIso?: string | null;
  /** Repli legacy si `borrow_return_due_at` absent. */
  borrowExtensionDaysTotal?: number;
};

function fmt(iso: string) {
  return formatDateParis(iso);
}

function meta(ctx: Ctx, status: string): string {
  const sub = ctx.updatedAtIso ? getReturnShipmentSubtitle(status, ctx.updatedAtIso, fmt) : null;
  const base = `Commande ${ctx.orderNumberCompact}`;
  return sub ? `${base} · ${sub}` : base;
}

/** Accroche hero : date de retour du panier (`carts.borrow_return_due_at`). */
function heroTaglineReturnBeforeDeadline(ctx: Ctx): string {
  const label = (ctx.membershipLabel ?? "Guest") as SegnaBorrowMembershipLabel;
  const deadlineMs = resolveCartBorrowReturnDueMs({
    borrowReturnDueAtIso: ctx.borrowReturnDueAtIso,
    outboundDeliveredAtIso: ctx.outboundDeliveredAtIso,
    membershipLabel: label,
    borrowExtensionDaysTotal: ctx.borrowExtensionDaysTotal ?? 0,
  });
  if (!Number.isFinite(deadlineMs)) {
    return "Retourne ta box d’ici les délais indiqués sur ta commande";
  }
  return `Retourne ta box d’ici le ${formatBorrowReturnDueDateShortFr(deadlineMs)}`;
}

function returnActionFlags(ctx: Ctx): {
  showReturnPrepareButton: boolean;
  showReturnTrackingButton: boolean;
  showReturnResetButton: boolean;
} {
  const hasXtTracking = isCartReturnMemberTrackingNumber(ctx.trackingNumber);
  return {
    showReturnPrepareButton: !hasXtTracking,
    showReturnTrackingButton: hasXtTracking,
    showReturnResetButton: hasXtTracking,
  };
}

/**
 * Contenu page `/exchange/retour/[cartId]` — même logique que l’emprunt : œil, accroche, textes, CTA, puis récap.
 */
export function getMemberReturnPageUi(statusRaw: string | null | undefined, ctx: Ctx): MemberReturnPageUi {
  const s = normalizeCartReturnShipmentStatus(statusRaw) ?? (statusRaw ?? "pending").toLowerCase();
  const phase = getMemberReturnShipmentPhaseCopy(s);
  const m = meta(ctx, s);
  const actions = returnActionFlags(ctx);

  const trackingHref =
    (ctx.trackingUrl && ctx.trackingUrl.trim().startsWith("http") ? ctx.trackingUrl.trim() : null) ??
    null;

  const prepareReturnCtas: ReturnPageCta[] = [];

  switch (s) {
    case "pending": {
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: heroTaglineReturnBeforeDeadline(ctx),
        bodyLines: [
          "Utilise la pochette fournie. Crée ton étiquette retour gratuitement sur le portail Sendcloud (données préremplies).",
        ],
        showBorrowDelayLearnMore: true,
        membershipLabel: ctx.membershipLabel,
        ctas: prepareReturnCtas,
        ...actions,
      };
    }
    case "ready": {
      const ctas: ReturnPageCta[] = prepareReturnCtas;
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: actions.showReturnTrackingButton
          ? "Ton étiquette retour est prête"
          : "Imprime et dépose ton colis",
        bodyLines: actions.showReturnTrackingButton
          ? ["Dépose ton colis au relais indiqué sur ton bordereau."]
          : [phase.detail],
        ctas,
        ...actions,
      };
    }
    case "dropped_out": {
      const feedbackHref = `/exchange/retour/${ctx.cartId}/avis`;
      const ctas: ReturnPageCta[] = [
        { label: "Note ton échange", href: feedbackHref, variant: "primary" },
        ...(trackingHref ? [{ label: "Suivre le colis", href: trackingHref, variant: "secondary" as const }] : []),
      ];
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Ton retour est en cours",
        bodyLines: [
          ctx.trackingNumber
            ? `Numéro de suivi : ${ctx.trackingNumber}`
            : "Ton colis est pris en charge par le transporteur vers Segna.",
          phase.detail,
          "Gagne des crédits en partageant ton avis sur les pièces que tu as portées.",
        ],
        ctas,
        showItemFeedbackCta: true,
        itemFeedbackHref: feedbackHref,
        showReturnPrepareButton: false,
        showReturnTrackingButton: false,
        showReturnResetButton: false,
      };
    }
    case "dropped_in": {
      const feedbackHref = `/exchange/retour/${ctx.cartId}/avis`;
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Ton échange est terminé",
        bodyLines: [phase.detail, "Gagne des crédits en partageant ton avis sur les pièces que tu as portées."],
        ctas: [{ label: "Note ton échange", href: feedbackHref, variant: "primary" }],
        showItemFeedbackCta: true,
        itemFeedbackHref: feedbackHref,
        showReturnPrepareButton: false,
        showReturnTrackingButton: false,
        showReturnResetButton: false,
      };
    }
    case "in_transit_out": {
      const feedbackHref = `/exchange/retour/${ctx.cartId}/avis`;
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Ton retour avance",
        bodyLines: [
          ctx.trackingNumber ? `Numéro de suivi : ${ctx.trackingNumber}` : phase.detail,
          "Tu peux suivre l’acheminement jusqu’à la réception chez Segna.",
          "Gagne des crédits en partageant ton avis sur les pièces que tu as portées.",
        ],
        ctas: [
          { label: "Note ton échange", href: feedbackHref, variant: "primary" },
          ...(trackingHref ? [{ label: "Suivre le colis", href: trackingHref, variant: "secondary" as const }] : []),
        ],
        showItemFeedbackCta: true,
        itemFeedbackHref: feedbackHref,
        showReturnPrepareButton: false,
        showReturnTrackingButton: false,
        showReturnResetButton: false,
      };
    }
    case "returned":
    case "en_verification": {
      const feedbackHref = `/exchange/retour/${ctx.cartId}/avis`;
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Vérification des pièces",
        bodyLines: [
          "Gagne des crédits en partageant ton avis sur les pièces que tu as portées.",
        ],
        ctas: [
          { label: "Note ton échange", href: feedbackHref, variant: "primary" },
          { label: "Retour à l’échange", href: "/exchange", variant: "secondary" },
        ],
        showItemFeedbackCta: true,
        itemFeedbackHref: feedbackHref,
        showReturnPrepareButton: false,
        showReturnTrackingButton: false,
        showReturnResetButton: false,
      };
    }
    case "return_validated":
    case "closed": {
      const feedbackHref = `/exchange/retour/${ctx.cartId}/avis`;
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Tout est bouclé",
        bodyLines: [
          phase.detail,
          "Gagne des crédits en partageant ton avis sur les pièces que tu as portées.",
        ],
        ctas: [
          { label: "Note ton échange", href: feedbackHref, variant: "primary" },
          { label: "Retour à l’échange", href: "/exchange", variant: "secondary" },
        ],
        showItemFeedbackCta: true,
        itemFeedbackHref: feedbackHref,
        showReturnPrepareButton: false,
        showReturnTrackingButton: false,
        showReturnResetButton: false,
      };
    }
    case "failed":
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Un blocage technique",
        bodyLines: [
          phase.detail,
          "Tu peux rouvrir le portail retour ci-dessous, ou contacter le support depuis « Aide échange ».",
        ],
        ctas: prepareReturnCtas,
        ...actions,
      };
    default:
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Suivi retour",
        bodyLines: [phase.detail],
        ctas: [{ label: "Retour à l’échange", href: "/exchange", variant: "secondary" }],
        showReturnPrepareButton: false,
        showReturnTrackingButton: false,
        showReturnResetButton: false,
      };
  }
}
