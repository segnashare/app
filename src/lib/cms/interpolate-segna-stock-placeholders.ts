import type { CmsFramePayload, CmsFrameRow } from "@/lib/cms/cms-types";
import { formatItemSizeLabel } from "@/lib/items/formatItemSizeLabel";

function hasMeaningfulSizeLabel(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (t === "-" || t === "—" || t === "–") return false;
  return true;
}

function replaceSegnaPlaceholders(text: string, pointsDisplayText: string, tailleText: string): string {
  return text
    .replaceAll("{{segna_mods}}", pointsDisplayText)
    .replaceAll("{{segna_taille}}", tailleText);
}

function interpolateString(
  value: string | undefined,
  pointsDisplayText: string,
  tailleText: string,
): string | undefined {
  if (value == null) return undefined;
  if (!value.includes("{{segna_")) return value;
  return replaceSegnaPlaceholders(value, pointsDisplayText, tailleText);
}

export type SegnaStockPlaceholderContext = {
  pricePoints: number | null;
  sizeLabel: string;
};

/**
 * Remplace `{{segna_mods}}` (points affichés) et `{{segna_taille}}` dans les champs texte du payload CMS
 * (titres, corps, CTA, etc.) pour les fiches stock Segna.
 */
export function interpolateSegnaStockPayload(
  payload: CmsFramePayload,
  ctx: SegnaStockPlaceholderContext,
): CmsFramePayload {
  const pointsDisplayText = ctx.pricePoints != null ? String(ctx.pricePoints) : "—";
  const tailleText = hasMeaningfulSizeLabel(ctx.sizeLabel)
    ? formatItemSizeLabel(ctx.sizeLabel)
    : "Taille unique";

  const next: CmsFramePayload = { ...payload };

  const strKeys: (keyof CmsFramePayload)[] = [
    "title",
    "subtitle",
    "body",
    "label",
    "header",
    "cta_label",
    "button_label",
    "target_url",
  ];
  for (const k of strKeys) {
    const v = payload[k];
    if (typeof v === "string") {
      (next as Record<string, unknown>)[k] = interpolateString(v, pointsDisplayText, tailleText);
    }
  }

  return next;
}

export function mapCmsRowsWithSegnaPlaceholders(rows: CmsFrameRow[], ctx: SegnaStockPlaceholderContext): CmsFrameRow[] {
  return rows.map((r) => ({
    ...r,
    payload: interpolateSegnaStockPayload(r.payload, ctx),
  }));
}
