import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";

/** Formats acceptés par GoTrue (`phone_change` souvent stocké sans `+`). */
export function phoneOtpLookupCandidates(phoneRaw: string): string[] {
  const e164 = normalizeFrenchPhoneToE164(phoneRaw);
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (t && !out.includes(t)) out.push(t);
  };

  push(e164);
  if (e164) {
    const digits = e164.replace(/\D/g, "");
    push(digits);
    push(`+${digits}`);
  }
  push(phoneRaw);
  const rawDigits = phoneRaw.replace(/\D/g, "");
  if (rawDigits) {
    push(rawDigits);
    push(`+${rawDigits}`);
  }
  return out;
}

/**
 * Vérifie un OTP SMS après `updateUser({ phone })`.
 * Essaie plusieurs formats / types car Auth stocke parfois `337…` sans `+`.
 */
export async function verifyPhoneChangeOtp(
  supabase: SupabaseClient,
  phoneRaw: string,
  token: string,
): Promise<{ ok: true } | { ok: false; message: string; rawMessage?: string }> {
  const code = token.replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) {
    return { ok: false, message: "Saisis le code à 6 chiffres." };
  }

  const candidates = phoneOtpLookupCandidates(phoneRaw);
  if (candidates.length === 0) {
    return { ok: false, message: "Numéro invalide." };
  }

  let lastMessage = "";
  for (const phone of candidates) {
    for (const type of ["phone_change", "sms"] as const) {
      const { error } = await supabase.auth.verifyOtp({ phone, token: code, type });
      if (!error) return { ok: true };
      lastMessage = error.message ?? lastMessage;
    }
  }

  const msg = lastMessage.toLowerCase();
  if (msg.includes("expired") || msg.includes("invalid") || msg.includes("otp") || msg.includes("token")) {
    return {
      ok: false,
      message: "Ce n'est pas le bon code. Renvoie un SMS puis saisis le dernier code reçu.",
      rawMessage: lastMessage,
    };
  }
  return { ok: false, message: lastMessage || "Vérification impossible.", rawMessage: lastMessage };
}
