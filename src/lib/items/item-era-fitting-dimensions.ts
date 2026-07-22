/** Collection pièce (décennie ou année précise). */
export const ITEM_ERA_DECADES = ["1980s", "1990s", "2000s", "2010s"] as const;
export type ItemEraDecade = (typeof ITEM_ERA_DECADES)[number];

export function isItemEraDecade(value: string): value is ItemEraDecade {
  return (ITEM_ERA_DECADES as readonly string[]).includes(value);
}

export function normalizeItemEra(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (isItemEraDecade(v)) return v;
  if (/^[12][0-9]{3}$/.test(v)) return v;
  return null;
}

export function formatItemEraLabel(era: string | null | undefined): string | null {
  const v = normalizeItemEra(era);
  if (!v) return null;
  if (isItemEraDecade(v)) return v.replace("s", "s"); // already "1990s"
  return v;
}

/** Clés de dimensions proposées au backoffice. */
export const ITEM_DIMENSION_FIELDS = [
  { key: "waist", label: "Tour de taille" },
  { key: "hips", label: "Tour de hanches" },
  { key: "bust", label: "Tour de poitrine" },
  { key: "length", label: "Longueur" },
  { key: "inseam", label: "Entrejambe" },
  { key: "sleeve", label: "Longueur manches" },
  { key: "shoulder", label: "Largeur épaules" },
  { key: "heel_height", label: "Hauteur talon" },
] as const;

export type ItemDimensionKey = (typeof ITEM_DIMENSION_FIELDS)[number]["key"];

export type ItemDimensions = Partial<Record<ItemDimensionKey, string>>;

export function parseItemDimensions(raw: unknown): ItemDimensions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ItemDimensions = {};
  const obj = raw as Record<string, unknown>;
  for (const field of ITEM_DIMENSION_FIELDS) {
    const v = obj[field.key];
    if (typeof v === "string" && v.trim()) out[field.key] = v.trim().slice(0, 80);
  }
  return out;
}

export function itemDimensionsEntries(raw: unknown): Array<{ key: ItemDimensionKey; label: string; value: string }> {
  const dims = parseItemDimensions(raw);
  return ITEM_DIMENSION_FIELDS.flatMap((field) => {
    const value = dims[field.key];
    return value ? [{ key: field.key, label: field.label, value }] : [];
  });
}

export function compactItemDimensions(dims: ItemDimensions): ItemDimensions | null {
  const out: ItemDimensions = {};
  for (const field of ITEM_DIMENSION_FIELDS) {
    const v = dims[field.key]?.trim();
    if (v) out[field.key] = v.slice(0, 80);
  }
  return Object.keys(out).length ? out : null;
}

/** Affichage valeur dimension : nombre (+ éventuel texte) + unité cm. */
export function formatItemDimensionDisplayValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withoutUnit = trimmed.replace(/\s*cm\.?\s*$/i, "").trim();
  return withoutUnit ? `${withoutUnit} cm` : "";
}
