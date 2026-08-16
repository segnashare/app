import type { SupabaseClient } from "@supabase/supabase-js";

import { formatLongDateParis } from "@/lib/datetime/segna-datetime";
import { escapeHtml, segnaTransactionalEmailShell } from "@/lib/notifications/email-html";
import { sendExpoPushToUser } from "@/lib/notifications/expo-push-send";
import { claimNotificationSend, mergeDeliveryChannels, releaseNotificationSend, setNotificationDeliveryChannels } from "@/lib/notifications/idempotency";
import type { NotificationDeliveryChannels } from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import { sendTransactionalEmail } from "@/lib/notifications/resend-send";

function firstNameOrBonjour(firstName: string | null | undefined): string {
  const t = firstName?.trim();
  if (t) return t;
  return "Bonjour";
}

function cancelScheduledBlocks(prenom: string, periodEndLabel: string, cartCount: number): { text: string; html: string; subject: string } {
  const p = escapeHtml(prenom);
  const d = escapeHtml(periodEndLabel);
  const cartsLine =
    cartCount > 0
      ? `Tes location(s) en cours se terminent le ${periodEndLabel} — pense à renvoyer les pièces avant cette date.`
      : `Tu restes membre jusqu’au ${periodEndLabel}.`;
  const cartsHtml =
    cartCount > 0
      ? `<p style="margin:0 0 16px;">Tes location(s) en cours se terminent le <strong>${d}</strong> — pense à renvoyer les pièces avant cette date.</p>`
      : `<p style="margin:0 0 16px;">Tu restes membre jusqu’au <strong>${d}</strong>.</p>`;

  const subject = "Ton abonnement Segna s’arrête bientôt";
  const text =
    `${prenom},\n\n` +
    `Ton abonnement ne sera pas renouvelé. Tu conserves tes avantages et crédits jusqu’au ${periodEndLabel}.\n` +
    `${cartsLine}\n` +
    `Ensuite, ton compte repassera en Guest.\n\n` +
    `L’équipe Segna`;
  const bodyHtml = `
    <p style="margin:0 0 16px;">Bonjour ${p},</p>
    <p style="margin:0 0 16px;">Ton abonnement <strong>ne sera pas renouvelé</strong>. Tu conserves tes avantages et crédits jusqu’au <strong>${d}</strong>.</p>
    ${cartsHtml}
    <p style="margin:0 0 16px;">Ensuite, ton compte repassera en <strong>Guest</strong>.</p>
    <p style="margin:0;">À bientôt,<br /><span style="font-style:italic;">L’équipe Segna</span></p>`;
  const html = segnaTransactionalEmailShell({
    preheader: `Fin d’abonnement le ${periodEndLabel}`,
    title: subject,
    bodyHtml,
  });
  return { text, html, subject };
}

/**
 * Notif après annulation en fin de période (questionnaire membre ou webhook).
 */
export async function notifySubscriptionCancelScheduled(
  admin: SupabaseClient,
  input: {
    userId: string;
    subscriptionId: string;
    periodEndIso: string;
    updatedCartCount: number;
  },
): Promise<void> {
  const idempotencyKey = `txn:subscription_cancel_scheduled:${input.subscriptionId}`;
  const claimed = await claimNotificationSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionCancelScheduled,
    userId: input.userId,
    metadata: {
      stripe_subscription_id: input.subscriptionId,
      period_end: input.periodEndIso,
      updated_cart_count: input.updatedCartCount,
    },
  });
  if (!claimed) return;

  const { data: user } = await admin
    .from("users")
    .select("email, first_name")
    .eq("id", input.userId)
    .maybeSingle();

  const prenom = firstNameOrBonjour(user?.first_name ?? null);
  const periodEndLabel = formatLongDateParis(input.periodEndIso);
  const { text, html, subject } = cancelScheduledBlocks(prenom, periodEndLabel, input.updatedCartCount);

  const channels: NotificationDeliveryChannels | null = null;
  let delivery: NotificationDeliveryChannels | null = channels;
  try {
    const email = typeof user?.email === "string" ? user.email.trim() : "";
    if (email) {
      const sent = await sendTransactionalEmail({
        to: email,
        subject,
        text,
        html,
        idempotencyKey,
      });
      if (sent) {
        delivery = mergeDeliveryChannels(delivery, "email");
      }
    }

    const pushOk = await sendExpoPushToUser(admin, input.userId, {
      title: "Abonnement résilié",
      body: `Tu restes membre jusqu’au ${periodEndLabel}. Pense à renvoyer tes locations avant cette date.`,
      data: { href: "/exchange", kind: NotificationKind.subscriptionCancelScheduled },
    });
    if (pushOk) {
      delivery = mergeDeliveryChannels(delivery, "push");
    }

    if (!delivery || delivery === "none") {
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }
    await setNotificationDeliveryChannels(admin, idempotencyKey, delivery);
  } catch (e) {
    await releaseNotificationSend(admin, idempotencyKey);
    console.error("[notifications] subscription_cancel_scheduled", e);
  }
}
