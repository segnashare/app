import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";

let cachedExceptionPhones: Set<string> | null = null;

function parseMultiAccountPhonesFromEnv(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!raw?.trim()) return set;

  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const e164 = normalizeFrenchPhoneToE164(trimmed) ?? (trimmed.startsWith("+") ? trimmed : null);
    if (e164) set.add(e164);
  }

  return set;
}

/**
 * Numéros E.164 autorisés sur plusieurs comptes (dev / staff).
 * `NEXT_PUBLIC_SEGNA_MULTI_ACCOUNT_PHONE_E164` (client) — liste séparée par des virgules.
 * Ex. `+33781774735` ou `0781774735`.
 */
export function getMultiAccountPhoneExceptionsE164(): ReadonlySet<string> {
  if (cachedExceptionPhones) return cachedExceptionPhones;

  const raw =
    process.env.NEXT_PUBLIC_SEGNA_MULTI_ACCOUNT_PHONE_E164 ??
    process.env.SEGNA_MULTI_ACCOUNT_PHONE_E164;

  cachedExceptionPhones = parseMultiAccountPhonesFromEnv(raw);
  return cachedExceptionPhones;
}

export function isMultiAccountPhoneException(phoneE164OrRaw: string): boolean {
  const e164 = normalizeFrenchPhoneToE164(phoneE164OrRaw) ?? phoneE164OrRaw.trim();
  if (!e164.startsWith("+")) return false;
  return getMultiAccountPhoneExceptionsE164().has(e164);
}
