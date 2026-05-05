/** Chiffres locaux FR sans indicatif (9 chiffres après suppression du 0 initial). */
export function normalizeFrenchLocalNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("0") ? digits.slice(1) : digits;
}

export function frenchLocalToE164(localDigits: string): string {
  const national = normalizeFrenchLocalNumber(localDigits);
  return national.length === 9 ? `+33${national}` : "";
}

/** Ex. +33781234567 → "781234567" pour préremplir un champ local. */
export function e164ToFrenchNationalDigits(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("33") && d.length >= 11) return d.slice(2);
  return normalizeFrenchLocalNumber(e164);
}
