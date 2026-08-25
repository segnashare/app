import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/config/env";
import {
  claimNotificationSend,
  mergeDeliveryChannels,
  releaseNotificationSend,
  setNotificationDeliveryChannels,
  type NotificationDeliveryChannels,
} from "@/lib/notifications/idempotency";
import { shouldSendMemberCronSms } from "@/lib/notifications/member-sms-daily-cap";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
import {
  sendTransactionalEmail,
  type TransactionalEmailAttachment,
} from "@/lib/notifications/resend-send";
import { sendTransactionalSms } from "@/lib/notifications/twilio-send";
import { trackNotificationSentServer } from "@/lib/analytics/track-notification-sent-server";
import {
  allowsMarketingEmail,
  allowsMarketingPush,
  allowsMarketingSms,
  isMarketingNotificationKind,
  loadMemberCommsPreferences,
} from "@/lib/notifications/member-comms-preferences";
import { loadUserContact } from "@/lib/notifications/member-outreach-contact";
import {
  isMemberOutreachSmsRequested,
  tryUpgradeMemberOutreachSms,
} from "@/lib/notifications/member-outreach-sms-upgrade";
import { buildMemberPushData, sendExpoPushToUser } from "@/lib/notifications/expo-push-send";
import { isNotificationKindEnabled } from "@/lib/notifications/notification-kind-settings";

export type MemberOutreachChannels = "email" | "email+phone";

export { loadUserContact };

function pushBodyFromOutreach(input: {
  pushBody?: string;
  smsBody?: string;
  text: string;
  subject: string;
}): string {
  const dedicated = input.pushBody?.trim() ?? "";
  if (dedicated) return dedicated.slice(0, 240);
  const sms = input.smsBody?.trim() ?? "";
  if (sms) return sms.slice(0, 240);
  const text = input.text.trim().replace(/\s+/g, " ");
  if (text) return text.slice(0, 240);
  return input.subject.trim().slice(0, 240);
}

/**
 * Envoi membre générique (journal `notification_send_log` + e-mail HTML ; push Expo ;
 * SMS si demandé et push non délivré — fallback).
 */
export async function sendMemberOutreachNotification(
  admin: SupabaseClient,
  input: {
    userId: string;
    kind: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    subject: string;
    text: string;
    html: string;
    channels: MemberOutreachChannels;
    /** Titre push (défaut = `subject`). */
    pushTitle?: string;
    /** Corps push (sans lien). Si absent, retombe sur `smsBody` puis `text`. */
    pushBody?: string;
    /** SMS court (obligatoire si `channels` = email+phone et envoi SMS souhaité). */
    smsBody?: string;
    /**
     * Si `true` : SMS transactionnel sans `SEGNA_NOTIFY_SMS_ALERTS` (ex. logistique commande).
     * Si absent / `false` : SMS seulement avec `SEGNA_NOTIFY_SMS_ALERTS=1`.
     */
    transactionalSms?: boolean;
    /** Si `true` : envoie le SMS même quand le push a été délivré (ex. J-J, MED). */
    smsEvenIfPushDelivered?: boolean;
    /** Plafond SMS crons (2/jour Paris, emprunt prioritaire). */
    applyCronSmsDailyCap?: boolean;
    /** Dev / re-test : ignore le plafond SMS journalier. */
    skipCronSmsDailyCap?: boolean;
    cronSmsNowMs?: number;
    emailAttachments?: TransactionalEmailAttachment[];
  },
): Promise<void> {
  if (!(await isNotificationKindEnabled(admin, input.kind))) return;

  const smsRequested = isMemberOutreachSmsRequested({
    channels: input.channels,
    smsBody: input.smsBody,
    transactionalSms: input.transactionalSms,
  });

  const prefs = isMarketingNotificationKind(input.kind)
    ? await loadMemberCommsPreferences(admin, input.userId)
    : null;
  const allowMarketingEmail = !prefs || allowsMarketingEmail(prefs, input.kind);
  const allowMarketingSms = !prefs || allowsMarketingSms(prefs, input.kind);
  const allowMarketingPush = !prefs || allowsMarketingPush(prefs, input.kind);

  if (!allowMarketingEmail && !(smsRequested && allowMarketingSms) && !allowMarketingPush) {
    // Opt-out marketing total sur ce kind : ne pas journaliser comme envoyé.
    return;
  }

  const claimed = await claimNotificationSend(admin, {
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    userId: input.userId,
    metadata: input.metadata ?? {},
  });
  if (!claimed) {
    if (smsRequested && allowMarketingSms && input.smsBody?.trim()) {
      await tryUpgradeMemberOutreachSms(admin, {
        idempotencyKey: input.idempotencyKey,
        userId: input.userId,
        kind: input.kind,
        smsBody: input.smsBody,
        metadata: input.metadata,
        transactionalSms: input.transactionalSms,
        applyCronSmsDailyCap: input.applyCronSmsDailyCap,
        skipCronSmsDailyCap: input.skipCronSmsDailyCap,
        cronSmsNowMs: input.cronSmsNowMs,
      });
    }
    return;
  }

  const user = await loadUserContact(admin, input.userId);
  const email = user?.email?.trim();

  try {
    let delivery: NotificationDeliveryChannels | null = null;

    if (allowMarketingEmail && email) {
      const sent = await sendTransactionalEmail({
        to: email,
        subject: input.subject,
        text: input.text,
        html: input.html,
        idempotencyKey: input.idempotencyKey,
        attachments: input.emailAttachments,
      });
      if (sent) {
        delivery = mergeDeliveryChannels(delivery, "email");
      }
    } else if (allowMarketingEmail && !email) {
      console.warn("[notifications] member-outreach: pas d’e-mail (push/SMS possibles)", {
        userId: input.userId,
        kind: input.kind,
      });
    }

    let pushDelivered = false;
    if (allowMarketingPush) {
      const pushBody = pushBodyFromOutreach(input);
      pushDelivered = await sendExpoPushToUser(admin, input.userId, {
        title:
          (input.pushTitle?.trim() || input.subject.trim()).slice(0, 80) || "Segna",
        body: pushBody,
        data: buildMemberPushData({ kind: input.kind, metadata: input.metadata }),
      });
      if (pushDelivered) {
        delivery = mergeDeliveryChannels(delivery, "push");
      }
    }

    // SMS = fallback si push non délivré, sauf `smsEvenIfPushDelivered` (J-J / MED).
    let allowSms =
      smsRequested &&
      allowMarketingSms &&
      (input.smsEvenIfPushDelivered === true || !pushDelivered);
    if (allowSms && input.applyCronSmsDailyCap && !input.skipCronSmsDailyCap) {
      allowSms = await shouldSendMemberCronSms(
        admin,
        input.userId,
        input.kind,
        input.cronSmsNowMs ?? Date.now(),
      );
    }
    if (allowSms) {
      const phoneE164 = tryNormalizePhoneToE164(user?.phone ?? null);
      const smsText = input.smsBody?.trim() ?? "";
      if (phoneE164 && smsText) {
        try {
          const sent = await sendTransactionalSms({ toE164: phoneE164, body: smsText.slice(0, 320) });
          if (sent) {
            delivery = mergeDeliveryChannels(delivery, "phone");
            trackNotificationSentServer({
              userId: input.userId,
              kind: input.kind,
              idempotencyKey: input.idempotencyKey,
              metadata: input.metadata,
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[notifications] member-outreach sms failed", msg);
        }
      }
    }

    if (!delivery || delivery === "none") {
      await releaseNotificationSend(admin, input.idempotencyKey);
      return;
    }

    await setNotificationDeliveryChannels(admin, input.idempotencyKey, delivery);
  } catch (e) {
    await releaseNotificationSend(admin, input.idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] member-outreach send failed", msg);
  }
}

/**
 * Push + SMS fallback (journal). Pas d’e-mail.
 * Gate SMS identique à `sendMemberOutreachNotification` (`transactionalSms` ou `SEGNA_NOTIFY_SMS_ALERTS`).
 */
export async function sendMemberSmsOnlyNotification(
  admin: SupabaseClient,
  input: {
    userId: string;
    kind: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    smsBody: string;
    /** Titre push (défaut Segna). */
    pushTitle?: string;
    /** Corps push (défaut = `smsBody`). */
    pushBody?: string;
    transactionalSms?: boolean;
    /** Si `true` : SMS même quand le push a un ticket OK (permission OS coupée mais token encore actif). */
    smsEvenIfPushDelivered?: boolean;
    applyCronSmsDailyCap?: boolean;
    cronSmsNowMs?: number;
  },
): Promise<void> {
  if (!(await isNotificationKindEnabled(admin, input.kind))) return;

  const prefs = isMarketingNotificationKind(input.kind)
    ? await loadMemberCommsPreferences(admin, input.userId)
    : null;
  const allowMarketingSms = !prefs || allowsMarketingSms(prefs, input.kind);
  const allowMarketingPush = !prefs || allowsMarketingPush(prefs, input.kind);

  if (!allowMarketingSms && !allowMarketingPush) return;

  if (input.applyCronSmsDailyCap) {
    // Cap appliqué seulement si on risque d’envoyer un SMS (après échec push).
  }

  const claimed = await claimNotificationSend(admin, {
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    userId: input.userId,
    metadata: input.metadata ?? {},
  });
  if (!claimed) return;

  const smsAlertsOn = getServerEnv().SEGNA_NOTIFY_SMS_ALERTS?.trim() === "1";
  const smsGateOk = Boolean(input.smsBody.trim()) && (input.transactionalSms === true || smsAlertsOn);
  const pushBody = (input.pushBody?.trim() || input.smsBody.trim()).slice(0, 240);

  try {
    let delivery: NotificationDeliveryChannels | null = null;
    let pushDelivered = false;

    if (allowMarketingPush && pushBody) {
      pushDelivered = await sendExpoPushToUser(admin, input.userId, {
        title: (input.pushTitle?.trim() || "Segna").slice(0, 80),
        body: pushBody,
        data: buildMemberPushData({ kind: input.kind, metadata: input.metadata }),
      });
      if (pushDelivered) {
        delivery = mergeDeliveryChannels(delivery, "push");
      }
    }

    const allowSms =
      allowMarketingSms &&
      smsGateOk &&
      (input.smsEvenIfPushDelivered === true || !pushDelivered);

    if (allowSms) {
      if (input.applyCronSmsDailyCap) {
        const allowed = await shouldSendMemberCronSms(
          admin,
          input.userId,
          input.kind,
          input.cronSmsNowMs ?? Date.now(),
        );
        if (!allowed) {
          if (!delivery) {
            await releaseNotificationSend(admin, input.idempotencyKey);
          } else {
            await setNotificationDeliveryChannels(admin, input.idempotencyKey, delivery);
          }
          return;
        }
      }

      const user = await loadUserContact(admin, input.userId);
      const phoneE164 = tryNormalizePhoneToE164(user?.phone ?? null);
      if (!phoneE164) {
        console.warn("[notifications] member-outreach sms-only: pas de téléphone", {
          userId: input.userId,
          kind: input.kind,
        });
        if (!delivery) {
          await releaseNotificationSend(admin, input.idempotencyKey);
          return;
        }
        await setNotificationDeliveryChannels(admin, input.idempotencyKey, delivery);
        return;
      }

      const sent = await sendTransactionalSms({
        toE164: phoneE164,
        body: input.smsBody.trim().slice(0, 320),
      });
      if (sent) {
        delivery = mergeDeliveryChannels(delivery, "phone");
        trackNotificationSentServer({
          userId: input.userId,
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        });
      }
    }

    if (!delivery || delivery === "none") {
      await releaseNotificationSend(admin, input.idempotencyKey);
      return;
    }

    await setNotificationDeliveryChannels(admin, input.idempotencyKey, delivery);
  } catch (e) {
    await releaseNotificationSend(admin, input.idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] member-outreach sms-only send failed", msg);
  }
}
