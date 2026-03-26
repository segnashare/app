import type { SupabaseClient } from "@supabase/supabase-js";

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Fusionne des champs dans `metadata.mondial_relay` (service role).
 * Aligné sur le backoffice.
 */
export async function patchItemIntakeMondialRelayMetadata(
  service: SupabaseClient,
  itemId: string,
  patch: Record<string, string | null | undefined>,
  options?: { removeKeys?: string[] },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: row, error: selErr } = await service
    .from("item_intake")
    .select("metadata")
    .eq("item_id", itemId)
    .maybeSingle();

  if (selErr) return { ok: false, message: selErr.message };
  if (!row) return { ok: false, message: "item_intake introuvable pour cet item" };

  const meta = isPlainRecord(row.metadata) ? { ...row.metadata } : {};
  const prevMr = isPlainRecord(meta.mondial_relay) ? { ...(meta.mondial_relay as Record<string, unknown>) } : {};
  const nextMr = { ...prevMr } as Record<string, unknown>;

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || String(v).trim() === "") continue;
    nextMr[k] = String(v).trim();
  }

  for (const k of options?.removeKeys ?? []) {
    delete nextMr[k];
  }

  meta.mondial_relay = nextMr;
  const { error } = await service.from("item_intake").update({ metadata: meta }).eq("item_id", itemId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
