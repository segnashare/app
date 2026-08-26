import type { SupabaseClient } from "@supabase/supabase-js";

import { formatItemDisputePointsEuros } from "@/lib/disputes/item-dispute-defect-scale";
import { escapeHtml, segnaTransactionalEmailShell } from "@/lib/notifications/email-html";
import { NotificationKind } from "@/lib/notifications/kinds";
import {
  appendSmsAppLink,
  memberAppCommandeUrl,
} from "@/lib/notifications/member-app-links";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";

/**
 * Notif après paiement Stripe litige pièce → deep link dans `data` (pas dans le corps push).
 */
export async function notifyItemDisputeInvoicePaid(
  admin: SupabaseClient,
  input: {
    itemDisputeId: string;
    cartDisputeId: string | null;
    itemId: string | null;
    resolution: Record<string, unknown>;
    billedPoints: number;
    defectTier: string | null;
  },
): Promise<void> {
  let cartId: string | null = null;
  let userId: string | null = null;

  if (input.cartDisputeId) {
    const { data: cd } = await admin
      .from("cart_disputes")
      .select("cart_id, opened_by_user_id")
      .eq("id", input.cartDisputeId)
      .maybeSingle();
    cartId = typeof cd?.cart_id === "string" ? cd.cart_id : null;
    userId = typeof cd?.opened_by_user_id === "string" ? cd.opened_by_user_id : null;
  }

  if (!userId && cartId) {
    const { data: cart } = await admin
      .from("carts")
      .select("user_id")
      .eq("id", cartId)
      .maybeSingle();
    userId = typeof cart?.user_id === "string" ? cart.user_id : null;
  }

  if (!userId) return;

  let itemTitle = "ta pièce";
  const alert =
    input.resolution.memberAlert && typeof input.resolution.memberAlert === "object"
      ? (input.resolution.memberAlert as { itemTitle?: string })
      : null;
  if (typeof alert?.itemTitle === "string" && alert.itemTitle.trim()) {
    itemTitle = alert.itemTitle.trim();
  } else if (input.itemId) {
    const { data: item } = await admin
      .from("items")
      .select("title")
      .eq("id", input.itemId)
      .maybeSingle();
    if (typeof item?.title === "string" && item.title.trim()) {
      itemTitle = item.title.trim();
    }
  }

  const billedPoints = Math.max(0, Math.round(input.billedPoints));
  const amountLabel = billedPoints > 0 ? formatItemDisputePointsEuros(billedPoints) : null;
  const deepLink = cartId ? memberAppCommandeUrl(cartId) : null;
  const kind = NotificationKind.itemDisputeInvoicePaid;
  const pushTitle = "Litige clôturé";
  const pushBody = amountLabel
    ? `Le paiement de ${amountLabel} a bien été enregistré.`
    : `Le paiement pour « ${itemTitle} » a bien été enregistré.`;
  const subject = pushTitle;
  const paragraphs = [
    amountLabel
      ? `Nous avons bien reçu ton paiement (${amountLabel}) pour le litige sur « ${itemTitle} ».`
      : `Nous avons bien reçu ton paiement pour le litige sur « ${itemTitle} ».`,
    "Le litige pièce est résolu. Tu peux consulter le détail et la résolution sur ta page commande.",
  ];

  const { data: user } = await admin.from("users").select("first_name").eq("id", userId).maybeSingle();
  const firstName =
    (user as { first_name?: string | null } | null)?.first_name?.trim() || null;
  const greeting = firstName ? `Bonjour ${firstName},` : "Bonjour,";

  const textParts = [
    greeting,
    "",
    ...paragraphs,
    ...(deepLink ? ["", `Voir ta commande : ${deepLink}`] : []),
  ];
  const html = segnaTransactionalEmailShell({
    preheader: pushBody.slice(0, 140),
    title: subject,
    bodyHtml: [
      `<p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>`,
      ...paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`),
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
    idempotencyKey: `txn:${kind}:${input.itemDisputeId}`,
    metadata: {
      item_dispute_id: input.itemDisputeId,
      cart_id: cartId,
      cart_dispute_id: input.cartDisputeId,
      billed_points: billedPoints,
      open_item_dispute_alert: true,
    },
    subject,
    pushTitle,
    pushBody,
    text: textParts.join("\n"),
    html,
    channels: "email+phone",
    smsBody: deepLink ? appendSmsAppLink(pushBody, deepLink) : pushBody,
    transactionalSms: true,
  });
}
