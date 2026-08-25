import { normalizeFrenchLocalNumber, normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";

/** Code triche : numéro saisi OU OTP SMS. */
export const PHONE_ONBOARDING_CHEAT_CODE = "120972";

/**
 * E.164 FR mobile legacy (partagé) — encore reconnu comme cheat.
 * (`6` + `120972` + `00`).
 */
export const PHONE_ONBOARDING_CHEAT_E164 = "+33612097200";

/** Plage synthétique : +3361209XXXX (évite collision entre comptes de test). */
const CHEAT_E164_PREFIX = "+3361209";

export function isPhoneOnboardingCheat(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return false;
  const local = normalizeFrenchLocalNumber(raw);
  const e164 = normalizeFrenchPhoneToE164(raw);
  return (
    digits === PHONE_ONBOARDING_CHEAT_CODE ||
    local === PHONE_ONBOARDING_CHEAT_CODE ||
    digits === "06120972" ||
    digits === "33612097200" ||
    e164 === PHONE_ONBOARDING_CHEAT_E164 ||
    (typeof e164 === "string" && /^\+3361209\d{4}$/.test(e164))
  );
}

/**
 * Numéro synthétique unique par user (`+3361209` + 4 digits du uuid).
 * Évite le blocage « déjà utilisé » du numéro partagé legacy.
 */
export function cheatPhoneE164ForUser(userId: string): string {
  const hex = userId.replace(/-/g, "").toLowerCase();
  if (hex.length < 4) return PHONE_ONBOARDING_CHEAT_E164;
  const n = parseInt(hex.slice(0, 8), 16) % 10_000;
  return `${CHEAT_E164_PREFIX}${String(n).padStart(4, "0")}`;
}

/** E.164 pour onboarding : cheat → numéro synthétique (unique si userId), sinon FR classique. */
export function resolveOnboardingPhoneE164(
  raw: string,
  userId?: string | null,
): string | null {
  if (isPhoneOnboardingCheat(raw)) {
    const id = userId?.trim();
    if (id) return cheatPhoneE164ForUser(id);
    return PHONE_ONBOARDING_CHEAT_E164;
  }
  return normalizeFrenchPhoneToE164(raw);
}
