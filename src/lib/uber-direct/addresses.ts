/** Construit l’objet d’adresse FR attendu par l’API Uber (sérialisé en string JSON dans le corps). */
export function buildFranceUberAddressJson(label: string, cityHint: string | null): string {
  const labelTrim = label.trim();
  const postalMatch = labelTrim.match(/\b(\d{5})\b/);
  const postal = postalMatch?.[1] ?? "";
  const city =
    (cityHint ?? "").trim() ||
    (/\bParis\b/i.test(labelTrim) ? "Paris" : "") ||
    "France";
  const street = labelTrim
    .replace(/\s*,\s*\d{5}\b.*$/i, "")
    .replace(/\s*,\s*France\s*$/i, "")
    .trim();

  const o: Record<string, unknown> = {
    street_address: [street || labelTrim, ""],
    city,
    postal_code: postal,
    country: "FR",
  };
  return JSON.stringify(o);
}
