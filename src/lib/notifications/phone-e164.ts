/** Tente un E.164 minimal pour la France à partir du numéro stocké en base. */
export function tryNormalizePhoneToE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits.length >= 10 ? digits : null;
  }
  if (digits.startsWith("00")) {
    const rest = digits.slice(2);
    return rest.length >= 10 ? `+${rest}` : null;
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    return `+33${digits.slice(1)}`;
  }
  if (digits.startsWith("33") && digits.length >= 11) {
    return `+${digits}`;
  }
  return null;
}
