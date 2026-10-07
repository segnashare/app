/** Min chars before search filters the catalog (1-letter queries are too noisy). */
export const SHOP_SEARCH_MIN_CHARS = 2;

/** Description fallback only when primary fields yield nothing and query is specific enough. */
const DESCRIPTION_FALLBACK_MIN_CHARS = 5;

const WEIGHT = {
  brand: 100,
  category: 80,
  title: 60,
  attribute: 25,
  description: 5,
  /** Extra when the whole query equals a brand / category (facet-like intent). */
  facetBoost: 40,
} as const;

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function searchTokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** FR fashion synonym groups — any member expands to the whole group. */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["robe", "robes"],
  ["haut", "hauts", "top", "tops"],
  ["veste", "vestes", "gilet", "gilets", "blazer", "blazers"],
  ["manteau", "manteaux", "coat", "coats"],
  ["jupe", "jupes", "skirt", "skirts"],
  ["pantalon", "pantalons", "pants", "trousers"],
  ["ensemble", "ensembles", "set", "sets"],
  ["short", "shorts"],
  ["accessoire", "accessoires", "accessory", "accessories"],
  ["chaussure", "chaussures", "shoe", "shoes", "basket", "baskets", "sneaker", "sneakers"],
  ["sac", "sacs", "bag", "bags", "handbag", "handbags"],
  ["jean", "jeans"],
  ["pull", "pulls", "sweater", "sweaters", "knit", "knits"],
  ["chemise", "chemises", "shirt", "shirts"],
  ["blouse", "blouses"],
  ["noir", "noire", "noirs", "noires", "black"],
  ["blanc", "blanche", "blancs", "blanches", "white"],
  ["beige", "beiges"],
  ["bleu", "bleue", "bleus", "bleues", "blue"],
  ["rouge", "rouges", "red"],
  ["vert", "verte", "verts", "vertes", "green"],
  ["rose", "roses", "pink"],
  ["gris", "grise", "grises", "gray", "grey"],
  ["marron", "brown"],
  ["dore", "doree", "gold"],
  ["argente", "argentee", "silver"],
];

const SYNONYM_LOOKUP: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map((w) => normalizeSearchText(w)).filter(Boolean);
    const set = new Set(normalized);
    for (const word of normalized) map.set(word, set);
  }
  return map;
})();

export type ShopSearchableItem = {
  title?: string | null;
  description?: string | null;
  brand_label?: string | null;
  category_label?: string | null;
  color_label?: string | null;
  materials_label?: string | null;
  size_label?: string | null;
};

function expandToken(token: string): Set<string> {
  const out = new Set<string>([token]);
  const group = SYNONYM_LOOKUP.get(token);
  if (group) for (const w of group) out.add(w);
  // Light plural/singular when not already covered by synonym table.
  if (token.length >= 4 && token.endsWith("s")) out.add(token.slice(0, -1));
  else if (token.length >= 3) out.add(`${token}s`);
  return out;
}

/** Levenshtein distance capped early for fuzzy brand/category (1 edit). */
function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === 0 || lb === 0) return Math.abs(la - lb) <= 1;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (la > lb) i += 1;
    else if (lb > la) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < la || j < lb) edits += 1;
  return edits <= 1;
}

type FieldKind = "brand" | "category" | "title" | "attribute" | "description";

function scoreTokenAgainstField(token: string, fieldRaw: string, kind: FieldKind): number {
  const field = normalizeSearchText(fieldRaw);
  if (!field) return 0;

  const variants = expandToken(token);
  const fieldTokens = searchTokens(field);
  const weight =
    kind === "brand"
      ? WEIGHT.brand
      : kind === "category"
        ? WEIGHT.category
        : kind === "title"
          ? WEIGHT.title
          : kind === "attribute"
            ? WEIGHT.attribute
            : WEIGHT.description;

  let best = 0;
  for (const variant of variants) {
    if (!variant) continue;

    if (field === variant) {
      best = Math.max(best, weight + (kind === "brand" || kind === "category" ? 20 : 0));
      continue;
    }

    if (fieldTokens.some((t) => t.startsWith(variant) || variant.startsWith(t))) {
      const exactToken = fieldTokens.some((t) => t === variant);
      best = Math.max(best, exactToken ? weight : Math.round(weight * 0.75));
      continue;
    }

    if (variant.length >= 3 && field.includes(variant)) {
      best = Math.max(best, Math.round(weight * 0.55));
      continue;
    }

    if (
      (kind === "brand" || kind === "category") &&
      variant.length >= 3 &&
      fieldTokens.some((t) => t.length >= 3 && editDistanceAtMost1(variant, t))
    ) {
      best = Math.max(best, Math.round(weight * 0.7));
    }
  }

  return best;
}

function scoreItemFields(
  item: ShopSearchableItem,
  tokens: string[],
  includeDescription: boolean,
): number {
  if (tokens.length === 0) return 0;

  let total = 0;
  for (const token of tokens) {
    const brandScore = scoreTokenAgainstField(token, item.brand_label ?? "", "brand");
    const categoryScore = scoreTokenAgainstField(token, item.category_label ?? "", "category");
    const titleScore = scoreTokenAgainstField(token, item.title ?? "", "title");
    const colorScore = scoreTokenAgainstField(token, item.color_label ?? "", "attribute");
    const materialScore = scoreTokenAgainstField(token, item.materials_label ?? "", "attribute");
    const sizeScore = scoreTokenAgainstField(token, item.size_label ?? "", "attribute");
    const descScore = includeDescription
      ? scoreTokenAgainstField(token, item.description ?? "", "description")
      : 0;

    const tokenBest = Math.max(
      brandScore,
      categoryScore,
      titleScore,
      colorScore,
      materialScore,
      sizeScore,
      descScore,
    );
    if (tokenBest <= 0) return 0;
    total += tokenBest;
  }

  const joined = normalizeSearchText(tokens.join(" "));
  const brand = normalizeSearchText(item.brand_label ?? "");
  const category = normalizeSearchText(item.category_label ?? "");
  if (joined && brand && (joined === brand || expandToken(joined).has(brand))) {
    total += WEIGHT.facetBoost;
  }
  if (joined && category && (joined === category || expandToken(joined).has(category))) {
    total += WEIGHT.facetBoost;
  }

  return total;
}

/** Score > 0 means the item matches. Pass includeDescription for the weak fallback path. */
export function scoreShopItemSearch(
  item: ShopSearchableItem,
  rawQuery: string,
  options?: { includeDescription?: boolean },
): number {
  const q = normalizeSearchText(rawQuery.trim());
  if (q.length < SHOP_SEARCH_MIN_CHARS) return 1;
  const tokens = searchTokens(q);
  if (tokens.length === 0) return 1;
  return scoreItemFields(item, tokens, options?.includeDescription === true);
}

export function shopItemMatchesQuery(
  item: ShopSearchableItem,
  rawQuery: string,
  options?: { includeDescription?: boolean },
): boolean {
  const q = normalizeSearchText(rawQuery.trim());
  if (q.length < SHOP_SEARCH_MIN_CHARS) return true;
  return scoreShopItemSearch(item, rawQuery, options) > 0;
}

/**
 * Filter + score items. Primary fields first; if zero hits and query ≥ 5 chars,
 * retry with description as a weak fallback.
 * Returned list is sorted by score descending (stable for equal scores).
 */
export function filterAndScoreShopItems<T extends ShopSearchableItem>(
  items: readonly T[],
  rawQuery: string,
): Array<{ item: T; score: number }> {
  const q = normalizeSearchText(rawQuery.trim());
  if (q.length < SHOP_SEARCH_MIN_CHARS) {
    return items.map((item) => ({ item, score: 0 }));
  }

  const primary: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = scoreShopItemSearch(item, rawQuery, { includeDescription: false });
    if (score > 0) primary.push({ item, score });
  }

  let hits = primary;
  if (hits.length === 0 && q.length >= DESCRIPTION_FALLBACK_MIN_CHARS) {
    const fallback: Array<{ item: T; score: number }> = [];
    for (const item of items) {
      const score = scoreShopItemSearch(item, rawQuery, { includeDescription: true });
      if (score > 0) fallback.push({ item, score });
    }
    hits = fallback;
  }

  return hits.sort((a, b) => b.score - a.score);
}
