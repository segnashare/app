import type { SupabaseClient } from "@supabase/supabase-js";

import { cartOrderPaidEmailBlocks, walletCreditsEmailBlocks } from "@/lib/notifications/email-html";
import {
  claimNotificationSend,
  releaseNotificationSend,
  setNotificationDeliveryChannels,
} from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
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

/** Libellés courts pour SMS (aligné page commande : titre + marque si dispo). */
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

/** Corps SMS (≤ ~300 car. utiles pour rester en 1–2 segments GSM). */
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

/**
 * Après confirmation serveur du panier (webhook Stripe, sync retour, ou wallet-only).
 * E-mail HTML + SMS optionnel (« Segna is cooking » + noms des pièces) si Twilio est configuré et téléphone valide.
 * Clé d’idempotence : une notification par `cart_id`.
 */
export async function notifyCartOrderPaidAfterConfirmation(
  admin: SupabaseClient,
  input: { userId: string; cartId: string },
): Promise<void> {
  const idempotencyKey = `txn:cart_order_paid:${input.cartId}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.cartOrderPaid,
    userId: input.userId,
    metadata: { cart_id: input.cartId },
  });
  if (!claimed) return;

  const user = await loadUserContact(admin, input.userId);
  const prenom = firstNameOrBonjour(user?.first_name ?? null);
  const { text, html } = cartOrderPaidEmailBlocks(prenom, `${input.cartId.slice(0, 8)}`);
  const subject = "Commande Segna enregistrée";
  const itemLabels = await loadCartOrderItemLabelsForSms(admin, input.cartId);
  const smsBody = buildCartOrderCookingSms(itemLabels);

  try {
    const email = user?.email?.trim();
    if (!email) {
      console.warn("[notifications] cart_order_paid: pas d’e-mail utilisateur", { userId: input.userId });
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

    let delivery: "email" | "email+phone" = "email";
    const phoneE164 = tryNormalizePhoneToE164(user?.phone ?? null);
    if (phoneE164 && smsBody.trim()) {
      try {
        await sendTransactionalSms({ toE164: phoneE164, body: smsBody.trim().slice(0, 320) });
        delivery = "email+phone";
      } catch (smsErr) {
        const smsMsg = smsErr instanceof Error ? smsErr.message : String(smsErr);
        console.error("[notifications] cart_order_paid sms failed", smsMsg);
      }
    }

    await setNotificationDeliveryChannels(admin, idempotencyKey, delivery);
  } catch (e) {
    await releaseNotificationSend(admin, idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] cart_order_paid send failed", msg);
  }
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
