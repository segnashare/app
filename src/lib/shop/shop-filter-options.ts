import type { CategoryFilterOption } from "@/components/shop/ShopCatalog";

export function mapFilterRows(rows: unknown): { id: string; label: string }[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      const label =
        (typeof r.label === "string" && r.label.trim()) ||
        (typeof r.name === "string" && r.name.trim()) ||
        null;
      if (!id || !label) return null;
      return { id, label };
    })
    .filter((x): x is { id: string; label: string } => x !== null);
}

export function mapCategoryFilterRows(rows: unknown): CategoryFilterOption[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      const label =
        (typeof r.label === "string" && r.label.trim()) ||
        (typeof r.name === "string" && r.name.trim()) ||
        null;
      if (!id || !label) return null;
      const rawParent = r.parent_category_id;
      const parentId = typeof rawParent === "string" && rawParent.trim() ? rawParent.trim() : null;
      return { id, label, parentId };
    })
    .filter((x): x is CategoryFilterOption => x !== null);
}
