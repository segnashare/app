export type SizeFilterCategory = "top" | "bottom" | "shoes";

export type SizeFilterOption = { id: string; label: string; code: string };

export const SIZE_FILTER_RAYONS: { key: SizeFilterCategory; label: string }[] = [
  { key: "top", label: "Haut" },
  { key: "bottom", label: "Bas" },
  { key: "shoes", label: "Chaussures" },
];

/** Libellés connus (alignés onboarding) pour inférer le code si l’API ne l’expose pas. */
export const TOP_SIZE_LABELS = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const;
export const BOTTOM_SIZE_LABELS = ["32", "34", "36", "38", "40", "42", "44", "46", "48"] as const;
export const SHOES_SIZE_LABELS = Array.from({ length: 12 }, (_, i) => String(33 + i)) as readonly string[];

const TOP_SET = new Set<string>(TOP_SIZE_LABELS);
const BOTTOM_SET = new Set<string>(BOTTOM_SIZE_LABELS);
const SHOES_SET = new Set<string>(SHOES_SIZE_LABELS);

export function sizeCategoryFromCode(code: string): SizeFilterCategory | null {
  const c = code.trim().toLowerCase();
  if (c.startsWith("top:")) return "top";
  if (c.startsWith("bottom:")) return "bottom";
  if (c.startsWith("shoes:")) return "shoes";
  return null;
}

export function inferSizeCode(label: string, code?: string | null): string | null {
  const trimmedCode = code?.trim() ?? "";
  if (trimmedCode) return trimmedCode;

  const raw = label.trim();
  if (!raw) return null;
  if (raw.includes(":")) return raw;

  const upper = raw.toUpperCase();
  if (TOP_SET.has(upper)) return `top:${upper}`;
  if (BOTTOM_SET.has(raw)) return `bottom:${raw}`;
  if (SHOES_SET.has(raw)) return `shoes:${raw}`;
  return null;
}

export function groupSizesByCategory(sizes: SizeFilterOption[]): Record<SizeFilterCategory, SizeFilterOption[]> {
  const out: Record<SizeFilterCategory, SizeFilterOption[]> = { top: [], bottom: [], shoes: [] };
  for (const size of sizes) {
    const category = sizeCategoryFromCode(size.code);
    if (category) out[category].push(size);
  }
  for (const { key } of SIZE_FILTER_RAYONS) {
    out[key].sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));
  }
  return out;
}

/** Rayon actif à l’ouverture de la feuille taille (d’après la sélection ou le premier rayon non vide). */
export function initSizeSheetBrowseCategory(
  selectedIds: string[],
  sizes: SizeFilterOption[],
): SizeFilterCategory | null {
  if (selectedIds.length > 0) {
    const first = sizes.find((s) => selectedIds.includes(s.id));
    if (first) {
      const cat = sizeCategoryFromCode(first.code);
      if (cat) return cat;
    }
  }
  const grouped = groupSizesByCategory(sizes);
  for (const { key } of SIZE_FILTER_RAYONS) {
    if (grouped[key].length > 0) return key;
  }
  return null;
}

export function allSizeIdsInCategory(
  grouped: Record<SizeFilterCategory, SizeFilterOption[]>,
  category: SizeFilterCategory,
): string[] {
  return grouped[category].map((s) => s.id);
}

export function sousRayonLabel(category: SizeFilterCategory): string {
  switch (category) {
    case "top":
      return "Toutes les tailles haut";
    case "bottom":
      return "Toutes les tailles bas";
    case "shoes":
      return "Toutes les pointures";
  }
}
