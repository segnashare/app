import type { SupabaseClient } from "@supabase/supabase-js";

import { isGuestPurchaseCartOrder } from "@/lib/cart/guest-purchase-order";
import { cartOrderPaidEmailBlocks, walletCreditsEmailBlocks } from "@/lib/notifications/email-html";
import {
  claimNotificationSend,
  releaseNotificationSend,
  setNotificationDeliveryChannels,
} from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";
import { buildMemberPushData, sendExpoPushToUser } from "@/lib/notifications/expo-push-send";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
import { declareCartOrderToN8n } from "@/lib/notifications/notify-cart-order-n8n";
import { sendTransactionalEmail } from "@/lib/notifications/resend-send";
import { sendTransactionalSms } from "@/lib/notifications/twilio-send";

async function loadUserContact(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("users").select("email, phone, first_name").eq("id", userId).maybeSingle();

  if (error) {
    console.error("[notifications] loadUserContact", error.message);
    return null;
  }
  return data;
}

function firstNameOrBonjour(firstName: string | null | undefined): string {
  const t = firstName?.trim();
  if (t) return t;
  return "Bonjour";
}

type CartItemJoinForSms = {
  title?: string | null;
  item_custom_brand_label?: string | null;
  item_brands?: { label?: string | null } | null;
} | null;

/** Libellés courts pour push / SMS (aligné page commande : titre + marque si dispo). */
async function loadCartOrderItemLabelsForSms(admin: SupabaseClient, cartId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("cart_items")
    .select("items(title, item_custom_brand_label, item_brands(label))")
    .eq("cart_id", cartId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[notifications] loadCartOrderItemLabelsForSms", error.message);
    return [];
  }

  const rows = (data ?? []) as { items: CartItemJoinForSms }[];
  return rows.map((row) => {
    const item = row.items;
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    const brand =
      (typeof item?.item_custom_brand_label === "string" && item.item_custom_brand_label.trim()) ||
      (typeof item?.item_brands?.label === "string" && item.item_brands.label.trim()) ||
      "";
    if (title && brand) return `${title} (${brand})`;
    if (title) return title;
    if (brand) return brand;
    return "Pièce";
  });
}

/** Corps push « cooking » (≤ 240 car. Expo). */
function buildCartOrderCookingPushBody(itemLabels: string[]): string {
  const head = "Commande en prépa : ";
  const fallback = "Ta commande Segna est en préparation.";
  if (itemLabels.length === 0) return fallback;

  const maxTotal = 240;
  const budget = Math.max(40, maxTotal - head.length);
  let list = itemLabels.join(", ");
  if (list.length > budget) {
    list = `${list.slice(0, budget - 1)}…`;
  }
  return `${head}${list}`;
}

/** Corps SMS « cooking » (fallback si push non délivré ; ≤ ~300 car.). */
function buildCartOrderCookingSms(itemLabels: string[]): string {
  const head = "Segna is cooking — commande en prépa : ";
  const fallback = "Segna is cooking — ta commande Segna est en préparation.";
  if (itemLabels.length === 0) return fallback;

  const maxTotal = 300;
  const budget = Math.max(40, maxTotal - head.length);
  let list = itemLabels.join(", ");
  if (list.length > budget) {
    list = `${list.slice(0, budget - 1)}…`;
  }
  return `${head}${list}`;
}

/** Corps SMS confirmation achat (facture Stripe déjà envoyée par e-mail → SMS seul). */
function buildPurchaseOrderConfirmedSms(itemLabels: string[]): string {
  const head = "Segna is cooking — commande en prépa : ";
  const tail = " Suivi par SMS.";
  const fallback = "Segna is cooking — ta commande Segna est en préparation. Suivi par SMS.";
  if (itemLabels.length === 0) return fallback;

  const maxTotal = 300;
  const budget = Math.max(40, maxTotal - head.length - tail.length);
  let list = itemLabels.join(", ");
  if (list.length > budget) {
    list = `${list.slice(0, budget - 1)}…`;
  }
  return `${head}${list}.${tail}`;
}

/**
 * Achat (mode achat website ou Guest) : SMS de confirmation seul — l’e-mail est couvert
 * par la facture Stripe (`guest_purchase_invoiced`). Idempotent par `cart_id`.
 */
async function notifyPurchaseOrderPaidSms(
  admin: SupabaseClient,
  input: { userId: string; cartId: string },
): Promise<void> {
  const idempotencyKey = `txn:purchase_order_paid_sms:${input.cartId}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.cartOrderPaid,
    userId: input.userId,
    metadata: { cart_id: input.cartId, purchase: true },
  });
  if (!claimed) return;

  const user = await loadUserContact(admin, input.userId);
  const phoneE164 = tryNormalizePhoneToE164(user?.phone ?? null);
  if (!phoneE164) {
    await releaseNotificationSend(admin, idempotencyKey);
    return;
  }

  try {
    const itemLabels = await loadCartOrderItemLabelsForSms(admin, input.cartId);
    const smsBody = buildPurchaseOrderConfirmedSms(itemLabels);
    const sent = await sendTransactionalSms({ toE164: phoneE164, body: smsBody.trim().slice(0, 320) });
    if (!sent) {
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }
    await setNotificationDeliveryChannels(admin, idempotencyKey, "phone");
  } catch (e) {
    await releaseNotificationSend(admin, idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] purchase_order_paid sms failed", msg);
  }
}

/**
 * Après confirmation serveur du panier (webhook Stripe, sync retour, ou wallet-only).
 * Déclaration n8n (`N8N_OPS_ACTIVITY_WEBHOOK_URL` / legacy cart-order) + e-mail HTML + push « cooking »
 * (deep link commande) ; SMS « Segna is cooking » si push non délivré.
 * Achat : e-mail « cooking » remplacé par la facture Stripe, mais SMS de confirmation quand même.
 * Clés d’idempotence : une déclaration n8n et une notification e-mail/push/SMS par `cart_id`.
 */
export async function notifyCartOrderPaidAfterConfirmation(
  admin: SupabaseClient,
  input: { userId: string; cartId: string; skipMemberNotification?: boolean },
): Promise<void> {
  try {
    await declareCartOrderToN8n(admin, input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] declareCartOrderToN8n failed", msg);
  }

  const skipMember =
    input.skipMemberNotification === true || (await isGuestPurchaseCartOrder(admin, input.cartId));
  if (skipMember) {
    await notifyPurchaseOrderPaidSms(admin, input);
    return;
  }

  const user = await loadUserContact(admin, input.userId);
  const prenom = firstNameOrBonjour(user?.first_name ?? null);
  const { text, html } = cartOrderPaidEmailBlocks(prenom, `${input.cartId.slice(0, 8)}`);
  const itemLabels = await loadCartOrderItemLabelsForSms(admin, input.cartId);
  const pushBody = buildCartOrderCookingPushBody(itemLabels);
  const smsBody = buildCartOrderCookingSms(itemLabels);

  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.cartOrderPaid,
    idempotencyKey: `txn:cart_order_paid:${input.cartId}`,
    metadata: { cart_id: input.cartId },
    subject: "Commande Segna enregistrée",
    text,
    html,
    channels: "email+phone",
    pushTitle: "Segna is cooking",
    pushBody,
    smsBody,
    transactionalSms: true,
    // Permission OS coupée mais token encore actif → Expo « OK » sans affichage ; SMS obligatoire.
    smsEvenIfPushDelivered: true,
  });
}

/**
 * Après buyout location → achat (full = même commande ; partial = nouvelle commande à valider).
 */
export async function notifyCartRentalBuyout(
  admin: SupabaseClient,
  input: {
    userId: string;
    rentalCartId: string;
    purchaseCartId: string;
    full: boolean;
    itemCount: number;
    /** Si true : push seulement (l’e-mail facture Stripe couvre la conf). */
    skipEmail?: boolean;
  },
): Promise<void> {
  const purchaseCartId = input.purchaseCartId.trim();
  if (!purchaseCartId) return;

  const user = await loadUserContact(admin, input.userId);
  const prenom = firstNameOrBonjour(user?.first_name ?? null);
  const n = Math.max(1, Math.trunc(input.itemCount));
  const singular = n === 1;

  const subject = singular ? "Elle est à toi" : "Elles sont à toi";
  const pushBody = singular
    ? input.full
      ? "Ton achat est confirmé. Ta location est clôturée, la pièce t’appartient."
      : "Ton achat est confirmé. Cette pièce t’appartient — les autres restent en location."
    : "Ton paiement est confirmé : ces pièces sont maintenant à toi.";

  const text = singular
    ? input.full
      ? `${prenom},\n\nElle est à toi\n\nTon achat est confirmé. Parce que tu as déjà emprunté cette pièce, ta réduction membre a été appliquée au prix d’achat.\n\nTa location est maintenant clôturée et la pièce t’appartient.\n\nÀ bientôt,\nSegna`
      : `${prenom},\n\nElle est à toi\n\nTon achat est confirmé. Parce que tu as déjà emprunté cette pièce, ta réduction membre a été appliquée au prix d’achat.\n\nCette pièce ne fait plus partie de ta location, elle t’appartient. Les autres restent en location.\n\nÀ bientôt,\nSegna`
    : `${prenom},\n\nElles sont à toi\n\nTon paiement est confirmé : ces pièces ne font plus partie de ta location, elles sont maintenant à toi.\n\nTa réduction membre a bien été appliquée à chaque pièce que tu as choisi de garder.${input.full ? "" : " Les autres restent en location."}\n\nÀ bientôt,\nSegna`;

  const html = singular
    ? input.full
      ? `<p>${prenom},</p><p><strong>Elle est à toi</strong></p><p>Ton achat est confirmé. Parce que tu as déjà emprunté cette pièce, ta réduction membre a été appliquée au prix d’achat.</p><p>Ta location est maintenant clôturée et la pièce t’appartient.</p><p>À bientôt,<br/>Segna</p>`
      : `<p>${prenom},</p><p><strong>Elle est à toi</strong></p><p>Ton achat est confirmé. Parce que tu as déjà emprunté cette pièce, ta réduction membre a été appliquée au prix d’achat.</p><p>Cette pièce ne fait plus partie de ta location, elle t’appartient. Les autres restent en location.</p><p>À bientôt,<br/>Segna</p>`
    : `<p>${prenom},</p><p><strong>Elles sont à toi</strong></p><p>Ton paiement est confirmé : ces pièces ne font plus partie de ta location, elles sont maintenant à toi.</p><p>Ta réduction membre a bien été appliquée à chaque pièce que tu as choisi de garder.${input.full ? "" : " Les autres restent en location."}</p><p>À bientôt,<br/>Segna</p>`;

  if (input.skipEmail) {
    const idempotencyKey = `txn:cart_rental_buyout_push:${purchaseCartId}`;
    const claimed = await claimNotificationSend(admin, {
      idempotencyKey,
      kind: NotificationKind.cartRentalBuyout,
      userId: input.userId,
      metadata: {
        cart_id: purchaseCartId,
        rental_cart_id: input.rentalCartId,
        buyout_scope: input.full ? "full" : "partial",
        push_only: true,
      },
    });
    if (!claimed) return;
    try {
      await sendExpoPushToUser(admin, input.userId, {
        title: subject,
        body: pushBody,
        data: buildMemberPushData({
          kind: NotificationKind.cartRentalBuyout,
          metadata: {
            cart_id: purchaseCartId,
            deep_link: "commande",
          },
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[notifications] cart_rental_buyout push-only failed", msg);
    }
    return;
  }

  await sendMemberOutreachNotification(admin, {
    userId: input.userId,
    kind: NotificationKind.cartRentalBuyout,
    idempotencyKey: `txn:cart_rental_buyout:${purchaseCartId}`,
    metadata: {
      cart_id: purchaseCartId,
      rental_cart_id: input.rentalCartId,
      buyout_scope: input.full ? "full" : "partial",
      deep_link: "commande",
    },
    subject,
    text,
    html,
    channels: "email",
    pushTitle: subject,
    pushBody,
  });
}

/**
 * Après crédit wallet via Checkout `credits_purchase` (webhook et/ou route sync).
 */
export async function notifyWalletCreditsPurchased(
  admin: SupabaseClient,
  input: { userId: string; stripeCheckoutSessionId: string; creditsAmount: number },
): Promise<void> {
  const idempotencyKey = `txn:wallet_credits_stripe:${input.stripeCheckoutSessionId}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.walletCreditsStripe,
    userId: input.userId,
    metadata: {
      credits_amount: input.creditsAmount,
      checkout_session_id: input.stripeCheckoutSessionId,
    },
  });
  if (!claimed) return;

  const user = await loadUserContact(admin, input.userId);
  const prenom = firstNameOrBonjour(user?.first_name ?? null);
  const { text, html } = walletCreditsEmailBlocks(prenom, input.creditsAmount);
  const subject = "Crédits d’échange Segna";

  try {
    const email = user?.email?.trim();
    if (!email) {
      console.warn("[notifications] wallet_credits: pas d’e-mail utilisateur", { userId: input.userId });
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }

    const sent = await sendTransactionalEmail({
      to: email,
      subject,
      text,
      html,
      idempotencyKey,
    });
    if (!sent) {
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }
    await setNotificationDeliveryChannels(admin, idempotencyKey, "email");
  } catch (e) {
    await releaseNotificationSend(admin, idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] wallet_credits send failed", msg);
  }
}
