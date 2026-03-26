/**
 * Tente d’extraire rue / n° / CP / ville depuis `users.adress` (texte libre).
 * Le résultat doit toujours être vérifié côté BO avant envoi MR.
 */
export type ParsedMemberAddress = {
  sender_street: string;
  sender_houseno: string;
  sender_postcode: string;
  sender_city: string;
  sender_country: string;
};

export function parseMemberAdressForShipment(adress: string | null | undefined): ParsedMemberAddress | null {
  if (!adress?.trim()) return null;
  const normalized = adress.replace(/\r\n/g, "\n").trim();
  const singleLine = normalized.replace(/\n/g, ", ");

  const cpMatch = singleLine.match(/\b(\d{5})\b/);
  const postcode = (cpMatch?.[1] ?? "").trim();
  let withoutCp = singleLine.replace(/\b\d{5}\b/g, " ").replace(/\s+/g, " ").trim();

  const parts = withoutCp.split(",").map((p) => p.trim()).filter(Boolean);
  let city = "";
  let streetBlob = withoutCp;
  if (parts.length >= 2) {
    city = parts[parts.length - 1] ?? "";
    streetBlob = parts.slice(0, -1).join(", ");
  }

  const streetBlobTrim = streetBlob.trim();
  const houseStreet = streetBlobTrim.match(/^(\d+[A-Za-zÀ-ÿ\-]*)\s+(.+)$/u);
  const sender_houseno = houseStreet?.[1]?.trim() ?? "1";
  const sender_street = (houseStreet?.[2]?.trim() ?? streetBlobTrim).trim() || singleLine;

  return {
    sender_street,
    sender_houseno,
    sender_postcode: postcode,
    sender_city: city,
    sender_country: "FR",
  };
}
