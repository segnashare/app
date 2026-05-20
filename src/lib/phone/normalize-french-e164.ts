/**
 * E.164 France (`+33` + 9 chiffres). Corrige les doubles indicatifs (ex. `+3333781774735`).
 * Même logique que `fr-mobile.ts` — module conservé pour les imports historiques.
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
