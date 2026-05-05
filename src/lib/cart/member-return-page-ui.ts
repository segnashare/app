import { buildMondialRelayTrackingUrl } from "@/lib/shipping/mondial-relay-tracking-url";

import { getMemberReturnShipmentPhaseCopy, getReturnShipmentSubtitle } from "@/lib/cart/member-return-shipment-copy";
import { computeBorrowDeadlineMs } from "@/lib/emprunt/borrow-period";
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
  /** Livraison aller (`shipments.updated_at`) — pour l’accroche « retourne avant le … ». */
  outboundDeliveredAtIso?: string | null;
  membershipLabel?: MembershipLabel;
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
    return "Retourne ta box dans les délais indiqués sur ta commande";
  }
  const deliveredMs = Date.parse(iso);
  const deadlineMs = computeBorrowDeadlineMs(deliveredMs, label);
  if (!Number.isFinite(deadlineMs)) {
    return "Retourne ta box dans les délais indiqués sur ta commande";
  }
  return `Retourne ta box avant le ${fmtBorrowDeadlineDdMm(deadlineMs)}`;
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

  const commandeHref = `/commande/${ctx.cartId}`;

  switch (s) {
    case "pending": {
      return {
        headerTitle: phase.title,
        metaLine: m,
        heroTagline: heroTaglineReturnBeforeDeadline(ctx),
        bodyLines: [
          "Réutilise la pochette d’expédition initiale : le bordereau retour y est déjà glissé. Le PDF ci-dessous n’est qu’une copie de secours, purement optionnelle.",
        ],
        ctas: [{ label: "Voir la commande", href: commandeHref, variant: "primary" }],
        includeLabelClientBlock: true,
      };
    }
    case "ready": {
      /** Lien PDF dans le bloc client pour éviter le doublon avec le hero. */
      const ctas: ReturnPageCta[] = [{ label: "Voir la commande", href: commandeHref, variant: "primary" }];
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
          "Tu peux réessayer la génération ci-dessous, ou contacter le support depuis « Aide commande ».",
        ],
        ctas: [{ label: "Voir la commande", href: commandeHref, variant: "primary" }],
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
