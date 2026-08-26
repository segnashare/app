import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatItemDisputePointsEuros,
  isItemDisputeDefectTier,
  type ItemDisputeDefectTier,
} from "@/lib/disputes/item-dispute-defect-scale";
import { escapeHtml, segnaTransactionalEmailShell } from "@/lib/notifications/email-html";
import { NotificationKind } from "@/lib/notifications/kinds";
import {
  appendSmsAppLink,
  memberAppCommandeUrl,
} from "@/lib/notifications/member-app-links";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";

function kindForTier(tier: ItemDisputeDefectTier): string {
  switch (tier) {
    case "minor":
      return NotificationKind.itemDisputeMinorWarning;
    case "small_irreversible":
      return NotificationKind.itemDisputeSmallDefectCharged;
    case "major_irreversible":
      return NotificationKind.itemDisputeMajorDefectCharged;
    case "non_return":
      return NotificationKind.itemDisputeNonReturnCharged;
  }
}

function copyForTier(input: {
  tier: ItemDisputeDefectTier;
  itemTitle: string;
  billedPoints: number;
  billingPercent: number;
}): {
  subject: string;
  pushTitle: string;
  pushBody: string;
  paragraphs: string[];
} {
  const money = formatItemDisputePointsEuros(input.billedPoints);
  const title = input.itemTitle;
  switch (input.tier) {
    case "minor":
      return {
        subject: "Avertissement pièce",
        pushTitle: "Avertissement pièce",
        pushBody: `Défaut minime constaté sur « ${title} ». Aucun montant facturé.`,
        paragraphs: [
          `Un défaut minime a été constaté sur « ${title} ».`,
          "Aucun montant n’est facturé. Merci d’en prendre soin lors de tes prochains échanges — une modale d’information t’attend dans l’app.",
        ],
      };
    case "small_irreversible":
      return {
        subject: "Facturation du litige",
        pushTitle: "Facturation du litige",
        pushBody: `Nous prélevons ${money} pour « ${title} » (participation ${input.billingPercent} %).`,
        paragraphs: [
          `Un petit défaut irréversible a été constaté sur « ${title} ».`,
          `Une participation de ${input.billingPercent} % de la valeur (${money}) est facturée via Stripe. Le litige pièce sera résolu dès réception du paiement.`,
        ],
      };
    case "major_irreversible":
      return {
        subject: "Facturation du litige",
        pushTitle: "Facturation du litige",
        pushBody: `Nous prélevons ${money} pour « ${title} » (facturation ${input.billingPercent} %).`,
        paragraphs: [
          `Un gros défaut irréversible a été constaté sur « ${title} ».`,
          `Une facturation de ${input.billingPercent} % de la valeur (${money}) est émise via Stripe. Le litige pièce sera résolu dès réception du paiement.`,
        ],
      };
    case "non_return":
      return {
        subject: "Facturation du litige",
        pushTitle: "Facturation du litige",
        pushBody: `Nous prélevons ${money} pour « ${title} » non retourné.`,
        paragraphs: [
          `La non-restitution de « ${title} » a été constatée.`,
          `La totalité de la valeur (${money}) est facturée via Stripe. Le litige pièce sera résolu dès réception du paiement.`,
        ],
      };
  }
}

export async function notifyItemDisputeResolved(
  admin: SupabaseClient,
  input: {
    userId: string;
    itemDisputeId: string;
    cartId: string | null;
    tier: string;
    itemTitle: string;
    billedPoints: number;
    billingPercent: number;
    detailLines?: string[];
  },
): Promise<void> {
  if (!isItemDisputeDefectTier(input.tier)) return;
  const userId = input.userId.trim();
  if (!userId) return;

  const detailLines = (input.detailLines ?? []).map((l) => l.trim()).filter(Boolean);
  const multi = detailLines.length > 1;
  const money = formatItemDisputePointsEuros(input.billedPoints);
  const copy = multi
    ? {
        subject: "Facturation du litige",
        pushTitle: "Facturation du litige",
        pushBody:
          input.tier === "non_return"
            ? `Nous prélevons ${money} pour ${detailLines.length} pièces non retournées.`
            : `Nous prélevons ${money} pour ${detailLines.length} pièces.`,
        paragraphs: [
          input.tier === "non_return"
            ? `La non-restitution de ${detailLines.length} pièces a été constatée.`
            : `Un litige a été classé sur ${detailLines.length} pièces.`,
          `Montant total facturé via Stripe : ${money}. Détail :`,
          ...detailLines.map((l) => `· ${l}`),
          "Le litige sera résolu dès réception du paiement.",
        ],
      }
    : copyForTier({
        tier: input.tier,
        itemTitle: input.itemTitle.trim() || "ta pièce",
        billedPoints: input.billedPoints,
        billingPercent: input.billingPercent,
      });
  const kind = kindForTier(input.tier);
  const cartId = input.cartId?.trim() || "";
  const deepLink = cartId ? memberAppCommandeUrl(cartId) : null;

  const { data: user } = await admin.from("users").select("first_name").eq("id", userId).maybeSingle();
  const firstName =
    (user as { first_name?: string | null } | null)?.first_name?.trim() || null;
  const greeting = firstName ? `Bonjour ${firstName},` : "Bonjour,";

  const textParts = [
    greeting,
    "",
    ...copy.paragraphs,
    ...(deepLink ? ["", `Voir ta commande : ${deepLink}`] : []),
  ];
  const html = segnaTransactionalEmailShell({
    preheader: copy.pushBody.slice(0, 140),
    title: copy.subject,
    bodyHtml: [
      `<p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>`,
      ...copy.paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`),
      ...(deepLink
        ? [
            `<p style="margin:16px 0 0;"><a href="${escapeHtml(deepLink)}" style="color:#18181b;font-weight:600;">Voir ma commande</a></p>`,
          ]
        : []),
    ].join(""),
  });

  await sendMemberOutreachNotification(admin, {
    userId,
    kind,
    idempotencyKey: multi
      ? `txn:${kind}:batch:${input.itemDisputeId}`
      : `txn:${kind}:${input.itemDisputeId}`,
    metadata: {
      item_dispute_id: input.itemDisputeId,
      cart_id: cartId || null,
      tier: input.tier,
      billed_points: input.billedPoints,
      open_item_dispute_alert: true,
      multi_piece: multi,
    },
    subject: copy.subject,
    pushTitle: copy.pushTitle,
    pushBody: copy.pushBody,
    text: textParts.join("\n"),
    html,
    channels: "email+phone",
    smsBody: deepLink ? appendSmsAppLink(copy.pushBody, deepLink) : copy.pushBody,
    transactionalSms: true,
  });
}
