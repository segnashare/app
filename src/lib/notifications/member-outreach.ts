import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/config/env";
import {
  claimNotificationSend,
  releaseNotificationSend,
  setNotificationDeliveryChannels,
  type NotificationDeliveryChannels,
} from "@/lib/notifications/idempotency";
import { shouldSendMemberCronSms } from "@/lib/notifications/member-sms-daily-cap";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
import { sendTransactionalEmail } from "@/lib/notifications/resend-send";
import { sendTransactionalSms } from "@/lib/notifications/twilio-send";
import { trackNotificationSentServer } from "@/lib/analytics/track-notification-sent-server";
import { loadUserContact } from "@/lib/notifications/member-outreach-contact";
import {
  isMemberOutreachSmsRequested,
  tryUpgradeMemberOutreachSms,
} from "@/lib/notifications/member-outreach-sms-upgrade";

export type MemberOutreachChannels = "email" | "email+phone";

export { loadUserContact };

/**
 * Envoi membre générique (journal `notification_send_log` + e-mail HTML ; SMS si
 * `channels === "email+phone"`, `smsBody` renseigné, numéro valide et Twilio OK, et soit
 * `transactionalSms === true` (pas de gate), soit `SEGNA_NOTIFY_SMS_ALERTS=1` (rappels sensibles).
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
    /** SMS court (obligatoire si `channels` = email+phone et envoi SMS souhaité). */
    smsBody?: string;
    /**
     * Si `true` : SMS transactionnel sans `SEGNA_NOTIFY_SMS_ALERTS` (ex. logistique commande).
     * Si absent / `false` : SMS seulement avec `SEGNA_NOTIFY_SMS_ALERTS=1`.
     */
    transactionalSms?: boolean;
    /** Plafond SMS crons (2/jour Paris, emprunt prioritaire). */
    applyCronSmsDailyCap?: boolean;
    /** Dev / re-test : ignore le plafond SMS journalier. */
    skipCronSmsDailyCap?: boolean;
    cronSmsNowMs?: number;
  },
): Promise<void> {
  const smsRequested = isMemberOutreachSmsRequested({
    channels: input.channels,
    smsBody: input.smsBody,
    transactionalSms: input.transactionalSms,
  });

  const claimed = await claimNotificationSend(admin, {
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    userId: input.userId,
    metadata: input.metadata ?? {},
  });
  if (!claimed) {
    if (smsRequested && input.smsBody?.trim()) {
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
  if (!email) {
    console.warn("[notifications] member-outreach: pas d’e-mail", { userId: input.userId, kind: input.kind });
    await releaseNotificationSend(admin, input.idempotencyKey);
    return;
  }

  try {
    const sent = await sendTransactionalEmail({
      to: email,
      subject: input.subject,
      text: input.text,
      html: input.html,
      idempotencyKey: input.idempotencyKey,
    });
    if (!sent) {
      await releaseNotificationSend(admin, input.idempotencyKey);
      return;
    }

    const smsAlertsOn = getServerEnv().SEGNA_NOTIFY_SMS_ALERTS?.trim() === "1";
    let allowSms = smsRequested;
    if (allowSms && input.applyCronSmsDailyCap && !input.skipCronSmsDailyCap) {
      allowSms = await shouldSendMemberCronSms(
        admin,
        input.userId,
        input.kind,
        input.cronSmsNowMs ?? Date.now(),
      );
    }
    let delivery: NotificationDeliveryChannels = "email";
    if (allowSms) {
      const phoneE164 = tryNormalizePhoneToE164(user?.phone ?? null);
      const smsText = input.smsBody?.trim() ?? "";
      if (phoneE164 && smsText) {
        try {
          const sent = await sendTransactionalSms({ toE164: phoneE164, body: smsText.slice(0, 320) });
          if (sent) {
            delivery = "email+phone";
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

    await setNotificationDeliveryChannels(admin, input.idempotencyKey, delivery);
  } catch (e) {
    await releaseNotificationSend(admin, input.idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] member-outreach send failed", msg);
  }
}

/**
 * SMS seul (journal + `delivery_channels` = `phone`). Pas d’e-mail.
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
    transactionalSms?: boolean;
    applyCronSmsDailyCap?: boolean;
    cronSmsNowMs?: number;
  },
): Promise<void> {
  if (input.applyCronSmsDailyCap) {
    const allowed = await shouldSendMemberCronSms(
      admin,
      input.userId,
      input.kind,
      input.cronSmsNowMs ?? Date.now(),
    );
    if (!allowed) return;
  }

  const claimed = await claimNotificationSend(admin, {
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    userId: input.userId,
    metadata: input.metadata ?? {},
  });
  if (!claimed) return;

  const user = await loadUserContact(admin, input.userId);
  const smsAlertsOn = getServerEnv().SEGNA_NOTIFY_SMS_ALERTS?.trim() === "1";
  const allowSms = Boolean(input.smsBody.trim()) && (input.transactionalSms === true || smsAlertsOn);
  if (!allowSms) {
    await releaseNotificationSend(admin, input.idempotencyKey);
    return;
  }

  const phoneE164 = tryNormalizePhoneToE164(user?.phone ?? null);
  if (!phoneE164) {
    console.warn("[notifications] member-outreach sms-only: pas de téléphone", { userId: input.userId, kind: input.kind });
    await releaseNotificationSend(admin, input.idempotencyKey);
    return;
  }

  try {
    const sent = await sendTransactionalSms({ toE164: phoneE164, body: input.smsBody.trim().slice(0, 320) });
    if (!sent) {
      await releaseNotificationSend(admin, input.idempotencyKey);
      return;
    }
    trackNotificationSentServer({
      userId: input.userId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    await setNotificationDeliveryChannels(admin, input.idempotencyKey, "phone");
  } catch (e) {
    await releaseNotificationSend(admin, input.idempotencyKey);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] member-outreach sms-only send failed", msg);
  }
}
