/**
 * Mondial Relay Connect attend souvent un format précis pour `DeliveryMode.Location` (ex. 6 chiffres),
 * alors que le checkout peut stocker `FR-037312`. On enchaîne plusieurs formes pour maximiser le match plan de tri.
 */
export function mondialRelayRelayLocationVariants(raw: string | null | undefined): string[] {
  const t = String(raw ?? "").trim();
  if (!t) return [];

  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim();
    if (v && !out.includes(v)) out.push(v);
  };

  push(t);

  const withoutCountry = t.replace(/^([A-Z]{2})[-\s]+/i, "").trim();
  if (withoutCountry && withoutCountry !== t) push(withoutCountry);

  const digits = t.replace(/\D/g, "");
  if (digits.length >= 6) push(digits.slice(-6));
  else if (digits.length > 0) push(digits.padStart(6, "0"));

  return out;
}
