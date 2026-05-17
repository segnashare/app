import { buildMondialRelayTrackingUrl } from "@/lib/shipping/mondial-relay-tracking-url";

import { getMemberReturnShipmentPhaseCopy, getReturnShipmentSubtitle } from "@/lib/cart/member-return-shipment-copy";
import { applyBorrowExtensionDaysToDeadlineMs, computeBorrowDeadlineMs } from "@/lib/emprunt/borrow-period";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";

export type ReturnPageCta = {
  label: string;
  href: string;
  variant: "primary" | "secondary";
};

export type MemberReturnPageUi = {
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
  /** Bloc client : génération auto + PDF / erreur (pending, ready, failed). */
  includeLabelClientBlock: boolean;
};

type Ctx = {
  cartId: string;
  orderNumberCompact: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  updatedAtIso: string | null;
  /** Livraison aller : `shipments.delivered_at` si présent, sinon `updated_at` (legacy). */
  outboundDeliveredAtIso?: string | null;
  membershipLabel?: MembershipLabel;
  /** Jours de prolongation déjà payés (somme des extensions). */
  borrowExtensionDaysTotal?: number;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function meta(ctx: Ctx, status: string): string {
  const sub = ctx.updatedAtIso ? getReturnShipmentSubtitle(status, ctx.updatedAtIso, fmt) : null;
  const base = `Commande ${ctx.orderNumberCompact}`;
  return sub ? `${base} · ${sub}` : base;
}

function fmtBorrowDeadlineDdMm(deadlineMs: number): string {
  return new Date(deadlineMs).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

/** Accroche hero : même échéance que l’emprunt (`computeBorrowDeadlineMs`). */
function heroTaglineReturnBeforeDeadline(ctx: Ctx): string {
  const iso = ctx.outboundDeliveredAtIso;
  const label = ctx.membershipLabel ?? "Guest";
  if (!iso?.trim()) {
    return "Retourne ta box d’ici les délais indiqués sur ta commande";
  }
  const deliveredMs = Date.parse(iso);
  const baseDeadlineMs = computeBorrowDeadlineMs(deliveredMs, label);
  const deadlineMs = applyBorrowExtensionDaysToDeadlineMs(baseDeadlineMs, ctx.borrowExtensionDaysTotal ?? 0);
  if (!Number.isFinite(deadlineMs)) {
    return "Retourne ta box d’ici les délais indiqués sur ta commande";
  }
  return `Retourne ta box d’ici le ${fmtBorrowDeadlineDdMm(deadlineMs)}`;
}

/**
 * Contenu page `/exchange/retour/[cartId]` — même logique que l’emprunt : œil, accroche, textes, CTA, puis récap.
 */
export function getMemberReturnPageUi(statusRaw: string | null | undefined, ctx: Ctx): MemberReturnPageUi {
  const s = (statusRaw ?? "pending").toLowerCase();
  const phase = getMemberReturnShipmentPhaseCopy(s);
  const m = meta(ctx, s);

  const trackingHref =
    ctx.trackingNumber && ctx.trackingNumber.trim()
      ? buildMondialRelayTrackingUrl(ctx.trackingNumber.trim())
      : null;

  const empruntHref = `/exchange/emprunt/${ctx.cartId}`;
  const prolongerHref = `/commande/${ctx.cartId}/prolonger`;

  /** Prolonger (secondaire) au-dessus, retour échange / emprunt (primaire) en dessous. */
  const prepareReturnCtas: ReturnPageCta[] = [
    { label: "Prolonger l’échange", href: prolongerHref, variant: "secondary" },
    { label: "Retourner à l’échange", href: empruntHref, variant: "primary" },
  ];

  switch (s) {
    case "pending": {
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: heroTaglineReturnBeforeDeadline(ctx),
        bodyLines: ["Utilise la pochette et le bordereau d’expédition prévus pour le retour."],
        showBorrowDelayLearnMore: true,
        membershipLabel: ctx.membershipLabel,
        ctas: prepareReturnCtas,
        includeLabelClientBlock: true,
      };
    }
    case "ready": {
      /** Lien PDF dans le bloc client pour éviter le doublon avec le hero. */
      const ctas: ReturnPageCta[] = prepareReturnCtas;
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Imprime et dépose ton colis",
        bodyLines: [
          phase.detail,
          "Après dépôt, le suivi s’actualise automatiquement — tu n’as rien à valider dans l’app.",
        ],
        ctas,
        includeLabelClientBlock: true,
      };
    }
    case "dropped_out":
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Merci pour ton dépôt",
        bodyLines: [
          phase.detail,
          "Ton colis est pris en charge par le transporteur vers Segna.",
        ],
        ctas: trackingHref
          ? [{ label: "Suivre le colis", href: trackingHref, variant: "primary" }]
          : [],
        includeLabelClientBlock: false,
      };
    case "in_transit_out":
    case "in_transit_in":
    case "dropped_in":
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Ton retour avance",
        bodyLines: [phase.detail, "Tu peux suivre l’acheminement jusqu’à la réception chez Segna."],
        ctas: trackingHref
          ? [{ label: "Suivre sur Mondial Relay", href: trackingHref, variant: "primary" }]
          : [],
        includeLabelClientBlock: false,
      };
    case "returned":
    case "en_verification":
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Vérification des pièces",
        bodyLines: [],
        ctas: [{ label: "Retour à l’échange", href: "/exchange", variant: "secondary" }],
        includeLabelClientBlock: false,
      };
    case "return_validated":
    case "closed":
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Tout est bouclé",
        bodyLines: [phase.detail],
        ctas: [{ label: "Retour à l’échange", href: "/exchange", variant: "primary" }],
        includeLabelClientBlock: false,
      };
    case "failed":
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Un blocage technique",
        bodyLines: [
          phase.detail,
          "Tu peux réessayer la génération ci-dessous, ou contacter le support depuis « Aide échange ».",
        ],
        ctas: prepareReturnCtas,
        includeLabelClientBlock: true,
      };
    default:
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: "Suivi retour",
        bodyLines: [phase.detail],
        ctas: [{ label: "Retour à l’échange", href: "/exchange", variant: "secondary" }],
        includeLabelClientBlock: false,
      };
  }
}
