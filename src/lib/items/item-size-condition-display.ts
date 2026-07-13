const CONDITION_SHORT_LABEL: Record<string, string> = {
  neuf_etiquette: "Neuf",
  excellent: "Excellent",
  tres_bon: "Très bon",
  bon: "Bon",
  acceptable: "Acceptable",
  degrade: "Dégradé",
};

export function formatItemConditionShortLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return "—";

  const normalized = trimmed
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  if (normalized.includes("neuf")) return "Neuf";
  if (normalized.includes("excellent")) return "Excellent";
  if (normalized.includes("tres bon")) return "Très bon";
  if (normalized.startsWith("bon")) return "Bon";
  if (normalized.includes("acceptable")) return "Acceptable";
  if (normalized.includes("degrade")) return "Dégradé";

  return trimmed;
}

export function formatItemConditionShortLabelFromScore(score: string | null | undefined): string {
  if (!score) return "—";
  return CONDITION_SHORT_LABEL[score] ?? formatItemConditionShortLabel(score);
}

/** Audience affichée après « Taille recommandée » (Femme / Homme). */
export function recommendedSizeAudienceFromCategoryLabel(categoryLabel: string | null | undefined): string | null {
  const normalized = (categoryLabel ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  if (/\bfemme\b/.test(normalized) || normalized.includes("femme")) return "Femme";
  if (/\bhomme\b/.test(normalized) || normalized.includes("homme")) return "Homme";
  return null;
}

export function normalizeItemSizeValue(size: string | null | undefined): string {
  const trimmed = (size ?? "").trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return "—";
  if (trimmed.includes(":")) {
    const segment = trimmed.split(":").pop()?.trim();
    if (segment) return segment;
  }
  return trimmed;
}
