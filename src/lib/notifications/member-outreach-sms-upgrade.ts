import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/config/env";
import {
  mergeDeliveryChannels,
  setNotificationDeliveryChannels,
  type NotificationDeliveryChannels,
} from "@/lib/notifications/idempotency";
import { shouldSendMemberCronSms } from "@/lib/notifications/member-sms-daily-cap";
import { tryNormalizePhoneToE164 } from "@/lib/notifications/phone-e164";
import { sendTransactionalSms } from "@/lib/notifications/twilio-send";
import { trackNotificationSentServer } from "@/lib/analytics/track-notification-sent-server";

import {
  allowsMarketingSms,
  isMarketingNotificationKind,
  loadMemberCommsPreferences,
} from "@/lib/notifications/member-comms-preferences";
import { loadUserContact } from "@/lib/notifications/member-outreach-contact";

export function isMemberOutreachSmsRequested(input: {
  channels: "email" | "email+phone";
  smsBody?: string;
  transactionalSms?: boolean;
}): boolean {
  const smsAlertsOn = getServerEnv().SEGNA_NOTIFY_SMS_ALERTS?.trim() === "1";
  return (
    input.channels === "email+phone" &&
    Boolean(input.smsBody?.trim()) &&
    (input.transactionalSms === true || smsAlertsOn)
  );
}

/** Outreach terminé (ne pas re-tenter) : SMS ok, ou e-mail seul quand SMS non applicable. */
export function isMemberOutreachFullyDelivered(
  deliveryChannels: NotificationDeliveryChannels | string | null | undefined,
  smsRequested: boolean,
  smsDeliverable: boolean,
): boolean {
  const ch = String(deliveryChannels ?? "none");
  if (ch.includes("phone")) return true;
  if (ch === "email" && (!smsRequested || !smsDeliverable)) return true;
  return false;
}

/**
 * Rattrapage SMS quand l’envoi est journalisé sans canal phone
 * (`email`, `push`, `email+push`) — ex. push ticket OK puis DeviceNotRegistered,
 * plafond SMS journalier, échec Twilio transitoire.
 */
export async function tryUpgradeMemberOutreachSms(
  admin: SupabaseClient,
  input: {
    idempotencyKey: string;
    userId: string;
    kind: string;
    smsBody: string;
    metadata?: Record<string, unknown>;
    transactionalSms?: boolean;
    applyCronSmsDailyCap?: boolean;
    skipCronSmsDailyCap?: boolean;
    cronSmsNowMs?: number;
  },
): Promise<boolean> {
  const { data: log } = await admin
    .from("notification_send_log")
    .select("delivery_channels")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  const channels = String((log as { delivery_channels?: string } | null)?.delivery_channels ?? "none");
  if (channels.includes("phone")) return true;
  if (channels !== "email" && channels !== "push" && channels !== "email+push") return false;

  if (
    !isMemberOutreachSmsRequested({
      channels: "email+phone",
      smsBody: input.smsBody,
      transactionalSms: input.transactionalSms,
    })
  ) {
    return true;
  }

  if (isMarketingNotificationKind(input.kind)) {
    const prefs = await loadMemberCommsPreferences(admin, input.userId);
    if (!allowsMarketingSms(prefs, input.kind)) return true;
  }

  const user = await loadUserContact(admin, input.userId);
  const phoneE164 = tryNormalizePhoneToE164(user?.phone ?? null);
  if (!phoneE164) return true;

  let allowSms = true;
  if (input.applyCronSmsDailyCap && !input.skipCronSmsDailyCap) {
    allowSms = await shouldSendMemberCronSms(
      admin,
      input.userId,
      input.kind,
      input.cronSmsNowMs ?? Date.now(),
    );
  }
  if (!allowSms) return false;

  const smsText = input.smsBody.trim().slice(0, 320);
  if (!smsText) return true;

  try {
    const sent = await sendTransactionalSms({ toE164: phoneE164, body: smsText });
    if (!sent) return false;

    const nextChannels = mergeDeliveryChannels(
      channels as NotificationDeliveryChannels,
      "phone",
    );
    await setNotificationDeliveryChannels(admin, input.idempotencyKey, nextChannels);
    trackNotificationSentServer({
      userId: input.userId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] member-outreach sms upgrade failed", msg);
    return false;
  }
}
