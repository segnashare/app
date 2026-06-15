/** Collecte récursive des `storage_path` dans un payload CMS. */
export function collectCmsStoragePaths(value: unknown, out = new Set<string>()): Set<string> {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectCmsStoragePaths(entry, out));
    return out;
  }
  if (typeof value !== "object") return out;

  const record = value as Record<string, unknown>;
  if (typeof record.storage_path === "string" && record.storage_path.trim()) {
    out.add(record.storage_path.trim());
  }
  Object.values(record).forEach((entry) => collectCmsStoragePaths(entry, out));
  return out;
}
