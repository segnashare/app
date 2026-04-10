import type { CmsFrameRow } from "@/lib/cms/cms-types";

/** UUIDs référencées par des frames `shop_item_ref` (rails CMS panier, profil, etc.). */
export function collectCmsShopItemIdsFromFrameRows(rows: CmsFrameRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.frame_type !== "shop_item_ref") continue;
    const id = typeof row.payload.item_id === "string" ? row.payload.item_id.trim() : "";
    if (id) out.push(id);
  }
  return [...new Set(out)];
}

export function collectCmsShopItemIdsFromSectionsByKey(sections: Record<string, { frames: CmsFrameRow[] }>): string[] {
  const all: string[] = [];
  for (const { frames } of Object.values(sections)) {
    all.push(...collectCmsShopItemIdsFromFrameRows(frames));
  }
  return [...new Set(all)];
}
