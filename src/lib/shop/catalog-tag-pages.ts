export type CatalogTagPageKind = "shop" | "inspiration";

export function buildCatalogTagPageHref(kind: CatalogTagPageKind, pageSlug: string): string {
  const slug = pageSlug.trim();
  if (!slug) return kind === "shop" ? "/shop" : "/community";
  return kind === "shop" ? `/shop/${encodeURIComponent(slug)}` : `/community/tag/${encodeURIComponent(slug)}`;
}
