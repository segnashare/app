import type { SupabaseClient } from "@supabase/supabase-js";

import { formatLongDateParis } from "@/lib/datetime/segna-datetime";
import { escapeHtml, segnaTransactionalEmailShell } from "@/lib/notifications/email-html";
import { sendExpoPushToUser } from "@/lib/notifications/expo-push-send";
import { claimNotificationSend, mergeDeliveryChannels, releaseNotificationSend, setNotificationDeliveryChannels } from "@/lib/notifications/idempotency";
import type { NotificationDeliveryChannels } from "@/lib/notifications/idempotency";
import { NotificationKind } from "@/lib/notifications/kinds";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
import { sendTransactionalEmail } from "@/lib/notifications/resend-send";
import {
  formatMissingSmsSecrets,
  missingTransactionalSmsSecrets,
  sendTransactionalSms,
} from "@/lib/notifications/twilio-send";

function firstNameOrBonjour(firstName: string | null | undefined): string {
  const t = firstName?.trim();
  if (t) return t;
  return "Bonjour";
}

async function resolveMemberPhoneE164(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: user, error } = await admin
    .from("users")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[notifications] cancel phone", error.message);
  }
  const fromUser = tryNormalizePhoneToE164(typeof user?.phone === "string" ? user.phone : null);
  if (fromUser) return fromUser;

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("profile_data")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) {
    console.error("[notifications] cancel profile phone", profileError.message);
    return null;
  }
  const raw = (profile?.profile_data ?? {}) as Record<string, unknown>;
  const phone =
    (typeof raw.phone_e164 === "string" && raw.phone_e164) ||
    (typeof raw.phone === "string" && raw.phone) ||
    null;
  return tryNormalizePhoneToE164(phone);
}

/** SMS seulement pour une annulation créée depuis le back-office. */
async function sendBackofficeCancelSms(
  admin: SupabaseClient,
  userId: string,
  body: string,
): Promise<boolean> {
  const missingSms = missingTransactionalSmsSecrets();
  if (missingSms.length > 0) {
    console.warn(
      `[notifications] cancel sms non envoyé : secret manquant ${formatMissingSmsSecrets(missingSms)}`,
    );
    return false;
  }
  const phoneE164 = await resolveMemberPhoneE164(admin, userId);
  if (!phoneE164) {
    console.warn("[notifications] cancel sms: pas de téléphone", { userId });
    return false;
  }
  return sendTransactionalSms({ toE164: phoneE164, body: body.slice(0, 320) });
}

/** Unix secondes, identique entre l’appel Stripe et le webhook. */
export function cancelEventToken(value: number | string | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const seconds = value > 10_000_000_000 ? Math.trunc(value / 1000) : Math.trunc(value);
    return String(seconds);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const seconds = n > 10_000_000_000 ? Math.trunc(n / 1000) : Math.trunc(n);
    return String(seconds);
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return String(Math.trunc(ms / 1000));
}

export function subscriptionCancelIdempotencyKey(
  kind: "scheduled" | "immediate",
  subscriptionId: string,
  eventAt: number | string | null | undefined,
): string {
  const prefix =
    kind === "scheduled" ? "txn:subscription_cancel_scheduled" : "txn:subscription_cancel_immediate";
  const token = cancelEventToken(eventAt);
  return token ? `${prefix}:${subscriptionId}:${token}` : `${prefix}:${subscriptionId}`;
}

type ScheduledCancelNotice = {
  idempotency_key: string;
  metadata: unknown;
  delivery_channels: string | null;
  created_at?: string;
};

function deliveryWasSent(channels: unknown): boolean {
  return typeof channels === "string" && channels.length > 0 && channels !== "none";
}

function periodEndFromLogMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as { period_end?: unknown }).period_end;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function sameInstant(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return a === b;
  return Math.abs(ta - tb) < 2000;
}

/** Fin de période atteinte (petite marge, comme le forfeit wallet). */
function periodEndReached(periodEndIso: string | null | undefined): boolean {
  if (!periodEndIso) return false;
  const t = Date.parse(periodEndIso);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now() + 2 * 60 * 1000;
}

/**
 * Dernière notif « fin de période » pour cet abonnement (nouvelle clé ou ancienne).
 * Sert aussi au forfeit wallet, qui ne doit pas dépendre de l’ancienne clé seule.
 */
export async function findLatestScheduledCancelNotice(
  admin: SupabaseClient,
  subscriptionId: string,
): Promise<ScheduledCancelNotice | null> {
  const id = subscriptionId.trim();
  if (!id) return null;

  const { data, error } = await admin
    .from("notification_send_log")
    .select("idempotency_key, metadata, delivery_channels, created_at")
    .eq("kind", NotificationKind.subscriptionCancelScheduled)
    .contains("metadata", { stripe_subscription_id: id })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[notifications] scheduled cancel lookup", error.message);
  }
  if (data && typeof data.idempotency_key === "string") {
    return data as ScheduledCancelNotice;
  }

  const { data: legacy, error: legacyError } = await admin
    .from("notification_send_log")
    .select("idempotency_key, metadata, delivery_channels, created_at")
    .eq("idempotency_key", `txn:subscription_cancel_scheduled:${id}`)
    .maybeSingle();
  if (legacyError) {
    console.error("[notifications] scheduled cancel legacy lookup", legacyError.message);
  }
  if (!legacy || typeof legacy.idempotency_key !== "string") return null;
  return legacy as ScheduledCancelNotice;
}

/** Claim bloqué en `none` après un crash : on le relâche pour réessayer. */
const STALE_UNSENT_CLAIM_MS = 2 * 60 * 1000;

async function claimCancelSend(
  admin: SupabaseClient,
  input: {
    idempotencyKey: string;
    kind: string;
    userId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  if (await claimNotificationSend(admin, input)) return true;

  const { data, error } = await admin
    .from("notification_send_log")
    .select("delivery_channels, created_at")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (error || !data) return false;
  if (deliveryWasSent(data.delivery_channels)) return false;
  const createdMs = typeof data.created_at === "string" ? Date.parse(data.created_at) : NaN;
  if (!Number.isFinite(createdMs) || Date.now() - createdMs < STALE_UNSENT_CLAIM_MS) return false;

  await releaseNotificationSend(admin, input.idempotencyKey);
  return claimNotificationSend(admin, input);
}

/**
 * Ancienne clé `txn:…:subscriptionId` (sans date) : elle couvre encore le même
 * événement déjà envoyé, pas une annulation plus tardive (autre période ou
 * `canceled_at` postérieur).
 */
async function legacyScheduledDeliveryCoversEvent(
  admin: SupabaseClient,
  subscriptionId: string,
  periodEndIso: string,
  cancelEventAt: number | string | null | undefined,
): Promise<boolean> {
  const { data, error } = await admin
    .from("notification_send_log")
    .select("delivery_channels, created_at, metadata")
    .eq("idempotency_key", `txn:subscription_cancel_scheduled:${subscriptionId}`)
    .maybeSingle();
  if (error || !data || !deliveryWasSent(data.delivery_channels)) return false;

  const loggedPeriod = periodEndFromLogMetadata(data.metadata);
  if (loggedPeriod && !sameInstant(loggedPeriod, periodEndIso)) return false;

  const token = cancelEventToken(cancelEventAt);
  const createdMs = typeof data.created_at === "string" ? Date.parse(data.created_at) : NaN;
  if (token && Number.isFinite(createdMs)) {
    const eventSec = Number(token);
    if (eventSec > createdMs / 1000 + 120) return false;
  }
  return true;
}

function loggedCancelEventToken(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as { cancel_event_at?: unknown }).cancel_event_at;
  if (typeof raw === "number" || typeof raw === "string") return cancelEventToken(raw);
  return null;
}

function deliveredRowCoversEvent(
  row: { delivery_channels?: unknown; created_at?: unknown; metadata?: unknown },
  cancelEventAt: number | string | null | undefined,
): boolean {
  if (!deliveryWasSent(row.delivery_channels)) return false;
  const token = cancelEventToken(cancelEventAt);
  const logged = loggedCancelEventToken(row.metadata);
  if (token && logged && token === logged) return true;
  const createdMs = typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
  if (token && Number.isFinite(createdMs) && Number(token) > createdMs / 1000 + 120) return false;
  return true;
}

async function coveringImmediateNoticeKey(
  admin: SupabaseClient,
  subscriptionId: string,
  cancelEventAt: number | string | null | undefined,
): Promise<string | null> {
  const { data: legacy, error: legacyError } = await admin
    .from("notification_send_log")
    .select("idempotency_key, delivery_channels, created_at, metadata")
    .eq("idempotency_key", `txn:subscription_cancel_immediate:${subscriptionId}`)
    .maybeSingle();
  if (legacyError) {
    console.error("[notifications] immediate cancel legacy lookup", legacyError.message);
  }
  if (
    legacy &&
    typeof legacy.idempotency_key === "string" &&
    deliveredRowCoversEvent(legacy, cancelEventAt)
  ) {
    return legacy.idempotency_key;
  }

  const { data, error } = await admin
    .from("notification_send_log")
    .select("idempotency_key, delivery_channels, created_at, metadata")
    .eq("kind", NotificationKind.subscriptionCancelImmediate)
    .contains("metadata", { stripe_subscription_id: subscriptionId })
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    console.error("[notifications] immediate cancel lookup", error.message);
    return null;
  }
  for (const row of data ?? []) {
    if (typeof row.idempotency_key === "string" && deliveredRowCoversEvent(row, cancelEventAt)) {
      return row.idempotency_key;
    }
  }
  return null;
}

async function deliveredScheduledCancelBlocksImmediate(
  admin: SupabaseClient,
  subscriptionId: string,
  periodEndIso: string | null,
): Promise<boolean> {
  const notice = await findLatestScheduledCancelNotice(admin, subscriptionId);
  if (!notice || !deliveryWasSent(notice.delivery_channels)) return false;
  const periodEnd = periodEndIso ?? periodEndFromLogMetadata(notice.metadata);
  if (!periodEnd) return true;
  return periodEndReached(periodEnd);
}

async function appendSmsIfClaimedWithoutPhone(
  admin: SupabaseClient,
  idempotencyKey: string,
  userId: string,
  body: string,
): Promise<void> {
  const { data, error } = await admin
    .from("notification_send_log")
    .select("delivery_channels")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error || !data) return;
  const channels = typeof data.delivery_channels === "string" ? data.delivery_channels : "none";
  if (!deliveryWasSent(channels) || channels.includes("phone")) return;
  const smsOk = await sendBackofficeCancelSms(admin, userId, body);
  if (!smsOk) return;
  await setNotificationDeliveryChannels(
    admin,
    idempotencyKey,
    mergeDeliveryChannels(channels as NotificationDeliveryChannels, "phone"),
  );
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
 * Notif après annulation en fin de période (questionnaire membre, webhook ou BO).
 * Une fois par événement (`canceled_at`, sinon fin de période) : le webhook ne
 * double pas l’envoi, une annulation ultérieure du même abonnement envoie à nouveau.
 */
export async function notifySubscriptionCancelScheduled(
  admin: SupabaseClient,
  input: {
    userId: string;
    subscriptionId: string;
    periodEndIso: string;
    updatedCartCount: number;
    /** `subscription.canceled_at` (unix ou ISO). Change à chaque nouvelle résiliation. */
    cancelEventAt?: number | string | null;
    /** SMS en plus de l’e-mail et du push. Réservé au back-office. */
    sendSms?: boolean;
  },
): Promise<void> {
  const eventAtForKey = input.cancelEventAt ?? input.periodEndIso;
  const idempotencyKey = subscriptionCancelIdempotencyKey("scheduled", input.subscriptionId, eventAtForKey);
  const periodEndLabel = formatLongDateParis(input.periodEndIso);
  const smsBody = `Ton abonnement Segna ne sera pas renouvelé. Tu restes membre jusqu’au ${periodEndLabel}.`;

  if (
    await legacyScheduledDeliveryCoversEvent(
      admin,
      input.subscriptionId,
      input.periodEndIso,
      input.cancelEventAt,
    )
  ) {
    if (input.sendSms) {
      await appendSmsIfClaimedWithoutPhone(
        admin,
        `txn:subscription_cancel_scheduled:${input.subscriptionId}`,
        input.userId,
        smsBody,
      );
    }
    return;
  }

  const claimed = await claimCancelSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionCancelScheduled,
    userId: input.userId,
    metadata: {
      stripe_subscription_id: input.subscriptionId,
      period_end: input.periodEndIso,
      cancel_event_at: cancelEventToken(eventAtForKey),
      updated_cart_count: input.updatedCartCount,
    },
  });
  if (!claimed) {
    if (input.sendSms) {
      await appendSmsIfClaimedWithoutPhone(admin, idempotencyKey, input.userId, smsBody);
    }
    return;
  }

  const { data: user } = await admin
    .from("users")
    .select("email, first_name")
    .eq("id", input.userId)
    .maybeSingle();

  const prenom = firstNameOrBonjour(user?.first_name ?? null);
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

    if (input.sendSms) {
      const smsOk = await sendBackofficeCancelSms(admin, input.userId, smsBody);
      if (smsOk) {
        delivery = mergeDeliveryChannels(delivery, "phone");
      }
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

function cancelImmediateBlocks(prenom: string): { text: string; html: string; subject: string } {
  const p = escapeHtml(prenom);
  const subject = "Ton abonnement Segna est résilié";
  const text =
    `${prenom},\n\n` +
    `Ton abonnement a été résilié immédiatement. Tes avantages membre s’arrêtent aujourd’hui, tes crédits sont remis à zéro et ton compte repasse en Guest.\n\n` +
    `L’équipe Segna`;
  const bodyHtml = `
    <p style="margin:0 0 16px;">Bonjour ${p},</p>
    <p style="margin:0 0 16px;">Ton abonnement a été <strong>résilié immédiatement</strong>.</p>
    <p style="margin:0 0 16px;">Tes avantages membre s’arrêtent aujourd’hui, tes crédits sont remis à zéro et ton compte repasse en <strong>Guest</strong>.</p>
    <p style="margin:0;">À bientôt,<br /><span style="font-style:italic;">L’équipe Segna</span></p>`;
  const html = segnaTransactionalEmailShell({
    preheader: "Résiliation immédiate — accès arrêté",
    title: subject,
    bodyHtml,
  });
  return { text, html, subject };
}

/**
 * Notif après résiliation immédiate (BO / portail Stripe / webhook deleted).
 * L’échéance naturelle d’une résiliation déjà notifiée ne renvoie pas ce message.
 * Une annulation immédiate BO (ou avant la date de fin) envoie quand même.
 */
export async function notifySubscriptionCancelImmediate(
  admin: SupabaseClient,
  input: {
    userId: string;
    subscriptionId: string;
    /** `subscription.canceled_at` (unix ou ISO). */
    cancelEventAt?: number | string | null;
    periodEndIso?: string | null;
    /**
     * Back-office : envoyer même si une notif fin de période existe et que
     * l’échéance est déjà passée.
     */
    sendDespiteScheduled?: boolean;
    /** SMS en plus de l’e-mail et du push. Réservé au back-office. */
    sendSms?: boolean;
  },
): Promise<void> {
  const smsBody = "Ton abonnement Segna est résilié. Tes avantages s’arrêtent aujourd’hui.";
  if (
    !input.sendDespiteScheduled &&
    (await deliveredScheduledCancelBlocksImmediate(admin, input.subscriptionId, input.periodEndIso ?? null))
  ) {
    return;
  }

  const alreadySentKey = await coveringImmediateNoticeKey(
    admin,
    input.subscriptionId,
    input.cancelEventAt,
  );
  if (alreadySentKey) {
    if (input.sendSms) {
      await appendSmsIfClaimedWithoutPhone(admin, alreadySentKey, input.userId, smsBody);
    }
    return;
  }

  const idempotencyKey = subscriptionCancelIdempotencyKey(
    "immediate",
    input.subscriptionId,
    input.cancelEventAt,
  );
  const claimed = await claimCancelSend(admin, {
    idempotencyKey,
    kind: NotificationKind.subscriptionCancelImmediate,
    userId: input.userId,
    metadata: {
      stripe_subscription_id: input.subscriptionId,
      mode: "immediate",
      cancel_event_at: cancelEventToken(input.cancelEventAt),
    },
  });
  if (!claimed) {
    if (input.sendSms) {
      await appendSmsIfClaimedWithoutPhone(admin, idempotencyKey, input.userId, smsBody);
    }
    return;
  }

  const { data: user } = await admin
    .from("users")
    .select("email, first_name")
    .eq("id", input.userId)
    .maybeSingle();

  const prenom = firstNameOrBonjour(user?.first_name ?? null);
  const { text, html, subject } = cancelImmediateBlocks(prenom);

  let delivery: NotificationDeliveryChannels | null = null;
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
      body: "Tes avantages membre s’arrêtent aujourd’hui.",
      data: { href: "/exchange", kind: NotificationKind.subscriptionCancelImmediate },
    });
    if (pushOk) {
      delivery = mergeDeliveryChannels(delivery, "push");
    }

    if (input.sendSms) {
      const smsOk = await sendBackofficeCancelSms(admin, input.userId, smsBody);
      if (smsOk) {
        delivery = mergeDeliveryChannels(delivery, "phone");
      }
    }

    if (!delivery || delivery === "none") {
      await releaseNotificationSend(admin, idempotencyKey);
      return;
    }
    await setNotificationDeliveryChannels(admin, idempotencyKey, delivery);
  } catch (e) {
    await releaseNotificationSend(admin, idempotencyKey);
    console.error("[notifications] subscription_cancel_immediate", e);
  }
}
