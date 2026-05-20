/** Chiffres locaux FR sans indicatif (9 chiffres après suppression du 0 initial). */
export function normalizeFrenchLocalNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("0") ? digits.slice(1) : digits;
}

export function frenchLocalToE164(localDigits: string): string {
  const normalized = normalizeFrenchPhoneToE164(localDigits);
  return normalized ?? "";
}

/**
 * E.164 France (`+33` + 9 chiffres). Corrige les doubles indicatifs (ex. `+3333781774735`
 * quand l’utilisateur a saisi `33781774735` dans un champ « local »).
 */
export function normalizeFrenchPhoneToE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let d = raw.trim().replace(/\s/g, "");
  if (!d) return null;

  if (d.startsWith("+")) d = d.slice(1);
  d = d.replace(/\D/g, "");
  if (!d) return null;

  if (d.startsWith("00")) d = d.slice(2);

  if (d.startsWith("33") && d.length === 11 && /^33[67]\d{8}$/.test(d)) {
    return `+${d}`;
  }

  if (d.startsWith("33") && d.length > 11) {
    const national = d.replace(/^(33)+/, "");
    if (national.length === 9 && /^[67]\d{8}$/.test(national)) return `+33${national}`;
    if (national.startsWith("33") && national.length === 11 && /^33[67]\d{8}$/.test(national)) {
      return `+${national}`;
    }
    if (national.startsWith("0") && national.length === 10) return `+33${national.slice(1)}`;
  }

  if (d.startsWith("0") && d.length === 10) {
    return `+33${d.slice(1)}`;
  }

  if (d.length === 9 && /^[67]\d{8}$/.test(d)) {
    return `+33${d}`;
  }

  if (d.startsWith("33") && d.length === 11) {
    return `+${d}`;
  }

  return null;
}

/** Ex. +33781234567 → "781234567" pour préremplir un champ local. */
export function e164ToFrenchNationalDigits(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("33") && d.length >= 11) return d.slice(2);
  return normalizeFrenchLocalNumber(e164);
}
