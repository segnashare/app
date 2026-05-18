import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";

/** Tente un E.164 minimal pour la France à partir du numéro stocké en base. */
export function tryNormalizePhoneToE164(raw: string | null | undefined): string | null {
  return normalizeFrenchPhoneToE164(raw);
}
