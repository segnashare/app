/** Normalise les drapeaux catalogue renvoyés en snake_case par les RPC. */
export function parseItemSizeIds(row: {
  item_size_ids?: unknown;
  item_size_id?: string | null;
}): string[] {
  if (Array.isArray(row.item_size_ids)) {
    const ids = row.item_size_ids.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (ids.length > 0) return ids;
  }
  return row.item_size_id ? [row.item_size_id] : [];
}

export function itemIntersectsSizeFilter(
  item: { item_size_ids?: unknown; item_size_id?: string | null },
  selectedIds: readonly string[],
): boolean {
  if (selectedIds.length === 0) return true;
  const allow = new Set(selectedIds);
  return parseItemSizeIds(item).some((id) => allow.has(id));
}

export function withShopCatalogItemFlags<
  T extends { isNew?: boolean; isArchive?: boolean; item_size_id?: string | null; item_size_ids?: unknown },
>(row: T & { is_new?: boolean; is_archive?: boolean }): T & {
  isNew: boolean;
  isArchive: boolean;
  item_size_ids: string[];
} {
  return {
    ...row,
    isNew: row.isNew === true || row.is_new === true,
    isArchive: row.isArchive === true || row.is_archive === true,
    item_size_ids: parseItemSizeIds(row),
  };
}
