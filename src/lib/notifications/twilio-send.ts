import twilio from "twilio";

import { getServerEnv } from "@/lib/config/env";

/** `false` si Twilio n’est pas configuré (pas d’envoi silencieux). */
export async function sendTransactionalSms(input: { toE164: string; body: string }): Promise<boolean> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID, TWILIO_FROM_NUMBER } =
    getServerEnv();

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.warn("[notifications] Twilio désactivé (TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN manquant).");
    return false;
  }

  if (!TWILIO_MESSAGING_SERVICE_SID && !TWILIO_FROM_NUMBER) {
    console.warn(
      "[notifications] Twilio désactivé (TWILIO_MESSAGING_SERVICE_SID ou TWILIO_FROM_NUMBER requis).",
    );
    return false;
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const payload: { to: string; body: string; messagingServiceSid?: string; from?: string } = {
    to: input.toE164,
    body: input.body,
  };
  if (TWILIO_MESSAGING_SERVICE_SID) {
    payload.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
  } else if (TWILIO_FROM_NUMBER) {
    payload.from = TWILIO_FROM_NUMBER;
  }

  await client.messages.create(payload);
  return true;
}
