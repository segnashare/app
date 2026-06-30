/** Téléphone FR attendu par Coursier (`0602030405`). */
export function normalizeCoursierPhone(
  userPhone: string | null | undefined,
  fallback: string | null,
): string | null {
  const raw = (userPhone ?? fallback ?? "").replace(/\s+/g, "").trim();
  if (!raw) return null;
  if (raw.startsWith("+33")) return `0${raw.slice(3)}`;
  if (/^33[67]\d{8}$/.test(raw)) return `0${raw.slice(2)}`;
  return raw;
}
