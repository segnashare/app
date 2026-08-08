import { apparelDisplayLabelForCode } from "@/lib/sizes/apparel-size-referential";

/** Valeur affichable : label DB, ou partie après « scope: » si un ancien brouillon a stocké le code. */
export function normalizeItemSizeDisplay(size: string): string {
  const trimmed = size.trim();
  if (!trimmed) return "";
  if (trimmed.includes(":")) {
    const fromReferential = apparelDisplayLabelForCode(trimmed);
    if (fromReferential.includes("/")) return fromReferential;
    const segment = trimmed.split(":").pop()?.trim();
    if (segment) return segment;
  }
  return trimmed;
}

/** Affichage : « Taille M / 38 / 10 », pas seulement « M ». Évite le double préfixe si déjà présent. */
export function formatItemSizeLabel(size: string): string {
  const s = normalizeItemSizeDisplay(size);
  if (!s) return s;
  if (/^taille\s+/i.test(s)) return s;
  return `Taille ${s}`;
}
