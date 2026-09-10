import {
  aggregateApparelSizeFacets,
  apparelBandFromLetter,
  apparelBandFromFr,
  expandApparelSizeMemberIds,
  type AggregatedApparelSizeFacet,
} from "@/lib/sizes/apparel-size-referential";

export type SizeFilterCategory = "apparel" | "shoes";

export type SizeFilterOption = {
  id: string;
  label: string;
  code: string;
  /** Ids top+bottom agrégés (filtre unifié). */
  memberIds?: string[];
};

export const SIZE_FILTER_RAYONS: { key: SizeFilterCategory; label: string }[] = [
  { key: "apparel", label: "Vêtements" },
  { key: "shoes", label: "Chaussures" },
];

/** Libellés lettre (onboarding / inférence) — alignés référentiel. */
export const TOP_SIZE_LABELS = [
  "XXXS",
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
  "4XL",
  "5XL",
  "6XL",
] as const;

/** Libellés FR bas (onboarding / inférence) — alignés référentiel. */
export const BOTTOM_SIZE_LABELS = [
  "30",
  "32",
  "34",
  "36",
  "38",
  "40",
  "42",
  "44",
  "46",
  "48",
  "50",
  "52",
] as const;

export const SHOES_SIZE_LABELS = Array.from({ length: 12 }, (_, i) => String(33 + i)) as readonly string[];

const TOP_SET = new Set<string>(TOP_SIZE_LABELS);
const BOTTOM_SET = new Set<string>(BOTTOM_SIZE_LABELS);
const SHOES_SET = new Set<string>(SHOES_SIZE_LABELS);

export function sizeCategoryFromCode(code: string): SizeFilterCategory | null {
  const c = code.trim().toLowerCase();
  if (c.startsWith("apparel:")) return "apparel";
  if (c.startsWith("top:") || c.startsWith("bottom:")) return "apparel";
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

  // Ancien libellé agrégé « M / 38 / 10 » ou range « XS/S/M »
  const parts = raw.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const letterBand = apparelBandFromLetter(parts[0]!);
    if (letterBand) return letterBand.topCode;
    const frBand = apparelBandFromFr(parts[0]!);
    if (frBand) return frBand.bottomCode;
  }
  return null;
}

function toAggregatedOption(row: AggregatedApparelSizeFacet<{ id: string; label: string; code?: string | null }>): SizeFilterOption {
  return {
    id: row.id,
    label: row.label,
    code: row.code ?? "",
    memberIds: row.memberIds,
  };
}

export function groupSizesByCategory(sizes: SizeFilterOption[]): Record<SizeFilterCategory, SizeFilterOption[]> {
  const apparelRaw: SizeFilterOption[] = [];
  const shoes: SizeFilterOption[] = [];

  for (const size of sizes) {
    const category = sizeCategoryFromCode(size.code);
    if (category === "shoes") shoes.push({ ...size, memberIds: size.memberIds ?? [size.id] });
    else if (category === "apparel") apparelRaw.push(size);
  }

  const apparel = aggregateApparelSizeFacets(
    apparelRaw.map((s) => ({ id: s.id, label: s.label, code: s.code })),
  )
    .map(toAggregatedOption)
    .filter((s) => !isTuSizeCode(s.code));

  shoes.sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));

  return { apparel, shoes };
}

function isTuSizeCode(code: string): boolean {
  const c = code.trim().toLowerCase();
  return c === "apparel:tu" || c === "top:tu" || c === "bottom:tu" || c.endsWith(":tu");
}

export type SizeFilterLayout = {
  showApparel: boolean;
  showShoes: boolean;
  /** Accessoires / sacs : taille unique, filtre inactif. */
  disabled: boolean;
};

function normalizeCategorySlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sizeKindFromCategoryLabel(label: string): "apparel" | "shoes" | "onesize" {
  const slug = normalizeCategorySlug(label);
  if (slug === "chaussures") return "shoes";
  if (slug === "accessoires" || slug === "sacs") return "onesize";
  return "apparel";
}

export function sizeFilterLayoutForCategoryLabels(labels: string[]): SizeFilterLayout {
  if (labels.length === 0) {
    return { showApparel: true, showShoes: true, disabled: false };
  }
  const kinds = new Set(labels.map(sizeKindFromCategoryLabel));
  const showApparel = kinds.has("apparel");
  const showShoes = kinds.has("shoes");
  if (!showApparel && !showShoes) {
    return { showApparel: false, showShoes: false, disabled: true };
  }
  return { showApparel, showShoes, disabled: false };
}

export function pruneSizeIdsForLayout(
  selectedIds: string[],
  sizes: SizeFilterOption[],
  layout: SizeFilterLayout,
): string[] {
  if (layout.disabled) return [];
  if (selectedIds.length === 0) return selectedIds;
  const grouped = groupSizesByCategory(sizes);
  const keep = new Set<string>();
  if (layout.showApparel) {
    for (const id of allSizeIdsInCategory(grouped, "apparel")) keep.add(id);
  }
  if (layout.showShoes) {
    for (const id of allSizeIdsInCategory(grouped, "shoes")) keep.add(id);
  }
  return selectedIds.filter((id) => keep.has(id));
}

/** Rayon actif à l’ouverture de la feuille taille (d’après la sélection ou le premier rayon non vide). */
export function initSizeSheetBrowseCategory(
  selectedIds: string[],
  sizes: SizeFilterOption[],
): SizeFilterCategory | null {
  const grouped = groupSizesByCategory(sizes);
  if (selectedIds.length > 0) {
    for (const { key } of SIZE_FILTER_RAYONS) {
      const hit = grouped[key].some(
        (s) => selectedIds.includes(s.id) || (s.memberIds ?? []).some((id) => selectedIds.includes(id)),
      );
      if (hit) return key;
    }
  }
  for (const { key } of SIZE_FILTER_RAYONS) {
    if (grouped[key].length > 0) return key;
  }
  return null;
}

export function allSizeIdsInCategory(
  grouped: Record<SizeFilterCategory, SizeFilterOption[]>,
  category: SizeFilterCategory,
): string[] {
  return grouped[category].flatMap((s) => s.memberIds ?? [s.id]);
}

export function sousRayonLabel(category: SizeFilterCategory): string {
  switch (category) {
    case "apparel":
      return "Toutes les tailles";
    case "shoes":
      return "Toutes les pointures";
  }
}

export function isSizeOptionSelected(option: SizeFilterOption, selectedIds: string[]): boolean {
  const members = option.memberIds ?? [option.id];
  return members.length > 0 && members.every((id) => selectedIds.includes(id));
}

export function toggleAggregatedSizeSelection(current: string[], option: SizeFilterOption): string[] {
  const members = option.memberIds ?? [option.id];
  const allSelected = members.every((id) => current.includes(id));
  if (allSelected) return current.filter((id) => !members.includes(id));
  return [...new Set([...current, ...members])];
}

export function expandSelectedSizeIds(selectedIds: string[], sizes: SizeFilterOption[]): string[] {
  const grouped = groupSizesByCategory(sizes);
  const aggregated = [...grouped.apparel, ...grouped.shoes].map((s) => ({
    id: s.id,
    memberIds: s.memberIds ?? [s.id],
  }));
  return expandApparelSizeMemberIds(selectedIds, aggregated);
}
