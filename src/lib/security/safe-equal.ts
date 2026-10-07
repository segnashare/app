import { createHash, timingSafeEqual } from "crypto";

/**
 * Comparaison de secrets en temps constant (évite les attaques par mesure de temps sur `===`).
 * Les deux valeurs sont hashées pour comparer des buffers de même longueur quelle que soit la taille d'entrée.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** `Authorization: Bearer <secret>` vs secret attendu, en temps constant. */
export function bearerMatches(request: Request, expected: string | null | undefined): boolean {
  if (!expected) return false;
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  return safeEqual(auth.slice(7).trim(), expected);
}
