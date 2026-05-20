import type { SupabaseClient } from "@supabase/supabase-js";

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Fusionne des champs dans `metadata.sendcloud` (service role). */
export async function patchItemIntakeSendcloudMetadata(
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
  const prev = isPlainRecord(meta.sendcloud) ? { ...(meta.sendcloud as Record<string, unknown>) } : {};
  const next = { ...prev } as Record<string, unknown>;

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || String(v).trim() === "") continue;
    next[k] = String(v).trim();
  }

  for (const k of options?.removeKeys ?? []) {
    delete next[k];
  }

  meta.sendcloud = next;
  const { error } = await service.from("item_intake").update({ metadata: meta }).eq("item_id", itemId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

const SHIPPING_LABEL_KEYS = [
  "label_url",
  "numero_suivi",
  "lien_suivi",
  "reference_expedition",
  "sc_order_number",
  "sc_return_portal_url",
  "sc_return_portal_identifier",
  "sc_outgoing_parcel_id",
  "sc_dummy_shipment_id",
  "sc_dummy_cancel_after_at",
  "sc_dummy_shipment_cancelled_at",
  "sc_return_portal_postal_code",
  "sc_merge_item_ids",
  "last_member_sc_error_at",
  "last_member_sc_error_message",
  "sc_member_help_requested_at",
  "sc_member_incident_note",
  "sc_shipping_mode",
  "sc_piggyback_cart_id",
  "sc_piggyback_shipment_id",
  "sc_piggyback_confirmed_at",
  "sc_piggyback_bo_box_confirmed_at",
  "sc_piggyback_member_box_confirmed_at",
] as const;

/** Retire étiquettes MR + champs Sendcloud (avant régénération Shop2Shop). */
export async function clearItemIntakeShippingLabelMetadata(
  service: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { data: row } = await service.from("item_intake").select("metadata").eq("item_id", itemId).maybeSingle();
  if (!row?.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return;
  const meta = { ...(row.metadata as Record<string, unknown>) };
  delete meta.mondial_relay;
  if (isPlainRecord(meta.sendcloud)) {
    const sc = { ...(meta.sendcloud as Record<string, unknown>) };
    for (const k of SHIPPING_LABEL_KEYS) delete sc[k];
    if (Object.keys(sc).length === 0) delete meta.sendcloud;
    else meta.sendcloud = sc;
  }
  await service.from("item_intake").update({ metadata: meta }).eq("item_id", itemId);
}

/** Retire l’étiquette legacy Mondial Relay après succès Sendcloud. */
export async function clearItemIntakeMondialRelayMetadata(
  service: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { data: row } = await service.from("item_intake").select("metadata").eq("item_id", itemId).maybeSingle();
  if (!row?.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return;
  const meta = { ...(row.metadata as Record<string, unknown>) };
  if (!("mondial_relay" in meta)) return;
  delete meta.mondial_relay;
  await service.from("item_intake").update({ metadata: meta }).eq("item_id", itemId);
}
