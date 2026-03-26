export type ItemOuttakeSnapshot = {
  stage: string;
  deletedAt: string | null;
  metadata: Record<string, unknown>;
};

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function parseItemOuttakeSnapshot(raw: unknown): ItemOuttakeSnapshot | null {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!isPlainRecord(row)) return null;
  const stage = typeof row.stage === "string" ? row.stage : String(row.stage ?? "none");
  const deletedAt = typeof row.deleted_at === "string" ? row.deleted_at : null;
  const metadata = isPlainRecord(row.metadata) ? row.metadata : {};
  return { stage, deletedAt, metadata };
}
