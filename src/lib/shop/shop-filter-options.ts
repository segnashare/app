import type { CategoryFilterOption } from "@/components/shop/ShopCatalog";
import { inferSizeCode, type SizeFilterOption } from "@/lib/shop/size-filter-groups";

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

export function mapSizeFilterRows(rows: unknown): SizeFilterOption[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      const rawCode = typeof r.code === "string" ? r.code : null;
      const label =
        (typeof r.label === "string" && r.label.trim()) ||
        (typeof r.name === "string" && r.name.trim()) ||
        null;
      if (!id || !label) return null;
      const code = inferSizeCode(label, rawCode);
      if (!code) return null;
      const displayLabel = code.includes(":") ? (code.split(":")[1]?.trim() || label) : label;
      return { id, label: displayLabel, code };
    })
    .filter((x): x is SizeFilterOption => x !== null);
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
