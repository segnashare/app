/**
 * Référentiel tailles vêtements (lettre / FR / US).
 * Une bande = équivalence top (lettre) ↔ bottom (FR).
 */
export type ApparelSizeBand = {
  key: string;
  letter: string;
  fr: string;
  us: string;
  label: string;
  topCode: string;
  bottomCode: string;
  sortOrder: number;
};

export const APPAREL_SIZE_BANDS: readonly ApparelSizeBand[] = [
  { key: "XXXS", letter: "XXXS", fr: "30", us: "2", label: "XXXS / 30 / 2", topCode: "top:XXXS", bottomCode: "bottom:30", sortOrder: 0 },
  { key: "XXS", letter: "XXS", fr: "32", us: "4", label: "XXS / 32 / 4", topCode: "top:XXS", bottomCode: "bottom:32", sortOrder: 1 },
  { key: "XS", letter: "XS", fr: "34", us: "6", label: "XS / 34 / 6", topCode: "top:XS", bottomCode: "bottom:34", sortOrder: 2 },
  { key: "S", letter: "S", fr: "36", us: "8", label: "S / 36 / 8", topCode: "top:S", bottomCode: "bottom:36", sortOrder: 3 },
  { key: "M", letter: "M", fr: "38", us: "10", label: "M / 38 / 10", topCode: "top:M", bottomCode: "bottom:38", sortOrder: 4 },
  { key: "L", letter: "L", fr: "40", us: "12", label: "L / 40 / 12", topCode: "top:L", bottomCode: "bottom:40", sortOrder: 5 },
  { key: "XL", letter: "XL", fr: "42", us: "14", label: "XL / 42 / 14", topCode: "top:XL", bottomCode: "bottom:42", sortOrder: 6 },
  { key: "XXL", letter: "XXL", fr: "44", us: "16", label: "XXL / 44 / 16", topCode: "top:XXL", bottomCode: "bottom:44", sortOrder: 7 },
  { key: "XXXL", letter: "XXXL", fr: "46", us: "18", label: "XXXL / 46 / 18", topCode: "top:XXXL", bottomCode: "bottom:46", sortOrder: 8 },
  { key: "4XL", letter: "4XL", fr: "48", us: "20", label: "4XL / 48 / 20", topCode: "top:4XL", bottomCode: "bottom:48", sortOrder: 9 },
  { key: "5XL", letter: "5XL", fr: "50", us: "22", label: "5XL / 50 / 22", topCode: "top:5XL", bottomCode: "bottom:50", sortOrder: 10 },
  { key: "6XL", letter: "6XL", fr: "52", us: "24", label: "6XL / 52 / 24", topCode: "top:6XL", bottomCode: "bottom:52", sortOrder: 11 },
] as const;

const BY_TOP = new Map(APPAREL_SIZE_BANDS.map((b) => [b.topCode.toLowerCase(), b]));
const BY_BOTTOM = new Map(APPAREL_SIZE_BANDS.map((b) => [b.bottomCode.toLowerCase(), b]));
const BY_LETTER = new Map(APPAREL_SIZE_BANDS.map((b) => [b.letter.toUpperCase(), b]));
const BY_FR = new Map(APPAREL_SIZE_BANDS.map((b) => [b.fr, b]));

export function apparelBandFromSizeCode(code: string | null | undefined): ApparelSizeBand | null {
  const c = (code ?? "").trim().toLowerCase();
  if (!c) return null;
  return BY_TOP.get(c) ?? BY_BOTTOM.get(c) ?? null;
}

export function apparelBandFromLetter(letter: string): ApparelSizeBand | null {
  return BY_LETTER.get(letter.trim().toUpperCase()) ?? null;
}

export function apparelBandFromFr(fr: string): ApparelSizeBand | null {
  return BY_FR.get(fr.trim()) ?? null;
}

export function apparelDisplayLabelForCode(code: string | null | undefined, fallbackLabel?: string | null): string {
  const band = apparelBandFromSizeCode(code);
  if (band) return band.label;
  const label = (fallbackLabel ?? "").trim();
  if (label) return label;
  const raw = (code ?? "").trim();
  if (!raw) return "";
  return raw.includes(":") ? (raw.split(":").pop() ?? raw) : raw;
}

export type ApparelSizeFacetLike = {
  id: string;
  label: string;
  code?: string | null;
};

export type AggregatedApparelSizeFacet<T extends ApparelSizeFacetLike = ApparelSizeFacetLike> = T & {
  /** Ids catalogue (top + bottom) agrégés sur la même bande. */
  memberIds: string[];
  bandKey: string;
};

/**
 * Agrège les facettes top/bottom équivalentes en une entrée par bande référentiel.
 * Les tailles hors référentiel (ex. bottom:33) et TU restent distinctes.
 */
export function aggregateApparelSizeFacets<T extends ApparelSizeFacetLike>(
  sizes: T[],
): Array<AggregatedApparelSizeFacet<T> | (T & { memberIds: string[]; bandKey: string })> {
  const byBand = new Map<string, { band: ApparelSizeBand; members: T[] }>();
  const passthrough: T[] = [];

  for (const size of sizes) {
    const code = (size.code ?? "").trim();
    const lower = code.toLowerCase();
    if (lower === "top:tu" || lower === "bottom:tu") {
      passthrough.push(size);
      continue;
    }
    const band = apparelBandFromSizeCode(code);
    if (!band) {
      passthrough.push(size);
      continue;
    }
    const existing = byBand.get(band.key);
    if (existing) existing.members.push(size);
    else byBand.set(band.key, { band, members: [size] });
  }

  const aggregated: AggregatedApparelSizeFacet<T>[] = [...byBand.values()]
    .sort((a, b) => a.band.sortOrder - b.band.sortOrder)
    .map(({ band, members }) => {
      const primary = members[0]!;
      return {
        ...primary,
        id: primary.id,
        label: band.label,
        code: `apparel:${band.key}`,
        memberIds: members.map((m) => m.id),
        bandKey: band.key,
      };
    });

  const uniquePassthrough = (() => {
    const tuMembers = passthrough.filter((s) => {
      const c = (s.code ?? "").trim().toLowerCase();
      return c === "top:tu" || c === "bottom:tu";
    });
    const others = passthrough.filter((s) => {
      const c = (s.code ?? "").trim().toLowerCase();
      return c !== "top:tu" && c !== "bottom:tu";
    });
    const out: Array<T & { memberIds: string[]; bandKey: string }> = others.map((s) => ({
      ...s,
      memberIds: [s.id],
      bandKey: (s.code ?? s.id).trim() || s.id,
    }));
    if (tuMembers.length > 0) {
      const primary = tuMembers[0]!;
      out.unshift({
        ...primary,
        id: primary.id,
        label: "Taille unique",
        code: "apparel:TU",
        memberIds: tuMembers.map((m) => m.id),
        bandKey: "TU",
      });
    }
    return out;
  })();

  return [...aggregated, ...uniquePassthrough];
}

/** Étend une sélection d’ids (représentants ou membres) à tous les ids équivalents. */
export function expandApparelSizeMemberIds(
  selectedIds: string[],
  aggregated: Array<{ id: string; memberIds: string[] }>,
): string[] {
  const selected = new Set(selectedIds);
  const out = new Set<string>();
  for (const opt of aggregated) {
    const hit = opt.memberIds.some((id) => selected.has(id)) || selected.has(opt.id);
    if (hit) for (const id of opt.memberIds) out.add(id);
  }
  for (const id of selectedIds) out.add(id);
  return [...out];
}
