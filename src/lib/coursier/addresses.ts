import type { CoursierAddress } from "@/lib/coursier/types";

/** Parse une adresse BAN / checkout Segna vers le format Coursier.fr. */
export function parseFranceCoursierAddress(label: string, cityHint: string | null): CoursierAddress {
  const labelTrim = label.trim();
  const postalMatch = labelTrim.match(/\b(\d{5})\b/);
  const postal = postalMatch?.[1] ?? "";
  const city =
    (cityHint ?? "").trim() ||
    (/\bParis\b/i.test(labelTrim) ? "Paris" : "") ||
    "";
  const street = labelTrim
    .replace(/\s*,\s*\d{5}\b.*$/i, "")
    .replace(/\s*,\s*France\s*$/i, "")
    .trim();

  return {
    Address: street || labelTrim,
    PostalCode: postal,
    City: city || "France",
    Country: "France",
  };
}
