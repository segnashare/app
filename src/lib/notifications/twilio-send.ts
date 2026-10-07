import twilio from "twilio";

import { getServerEnv } from "@/lib/config/env";

/**
 * Noms des variables absentes. Vide si Twilio peut envoyer.
 * `TWILIO_MESSAGING_SERVICE_SID` et `TWILIO_FROM_NUMBER` ne manquent que si les deux sont absents.
 */
export function missingTransactionalSmsSecrets(): string[] {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID, TWILIO_FROM_NUMBER } =
    getServerEnv();
  const missing: string[] = [];
  if (!TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
  if (!TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
  if (!TWILIO_MESSAGING_SERVICE_SID && !TWILIO_FROM_NUMBER) {
    missing.push("TWILIO_MESSAGING_SERVICE_SID");
    missing.push("TWILIO_FROM_NUMBER");
  }
  return missing;
}

export function formatMissingSmsSecrets(names: string[]): string {
  const needsSender =
    names.includes("TWILIO_MESSAGING_SERVICE_SID") && names.includes("TWILIO_FROM_NUMBER");
  if (!needsSender) return names.join(", ");
  const rest = names.filter(
    (name) => name !== "TWILIO_MESSAGING_SERVICE_SID" && name !== "TWILIO_FROM_NUMBER",
  );
  return [...rest, "TWILIO_MESSAGING_SERVICE_SID ou TWILIO_FROM_NUMBER"].join(", ");
}

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
