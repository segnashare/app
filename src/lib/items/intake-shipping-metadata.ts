/** Même contrainte que `/items/shipping` (1 à 5 UUID). */
const SHIPPING_ITEM_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Aligné sur `segna-backoffice` : sous-objet `metadata.mondial_relay`. */
export type ItemIntakeMondialRelayMetadata = {
  label_url?: string | null;
  numero_suivi?: string | null;
  lien_suivi?: string | null;
  reference_expedition?: string | null;
  last_backoffice_update_at?: string | null;
  notes_interne?: string | null;
  /** Liste des `item_id` fusionnés (CSV), renseignée par le BO lors d’une étiquette groupée. */
  mr_merge_item_ids?: string | null;
  /** Dernière erreur de génération auto côté app membre (diagnostic). */
  last_member_mr_error_at?: string | null;
  last_member_mr_error_message?: string | null;
  /** Le membre a demandé de l’aide depuis la page expédition. */
  mr_member_help_requested_at?: string | null;
  mr_member_incident_note?: string | null;
};

export function parseMondialRelayFromIntakeMetadata(metadata: unknown): ItemIntakeMondialRelayMetadata | null {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const root = metadata as Record<string, unknown>;
  const raw = root.mondial_relay;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === "string" ? m[k] : m[k] != null ? String(m[k]) : null);
  const out: ItemIntakeMondialRelayMetadata = {};
  const label_url = str("label_url");
  const numero_suivi = str("numero_suivi");
  const lien_suivi = str("lien_suivi");
  const reference_expedition = str("reference_expedition");
  const last_backoffice_update_at = str("last_backoffice_update_at");
  if (label_url) out.label_url = label_url;
  if (numero_suivi) out.numero_suivi = numero_suivi;
  if (lien_suivi) out.lien_suivi = lien_suivi;
  if (reference_expedition) out.reference_expedition = reference_expedition;
  if (last_backoffice_update_at) out.last_backoffice_update_at = last_backoffice_update_at;
  const mr_merge_item_ids = str("mr_merge_item_ids");
  if (mr_merge_item_ids) out.mr_merge_item_ids = mr_merge_item_ids;
  const notes_interne = str("notes_interne");
  if (notes_interne) out.notes_interne = notes_interne;
  const last_member_mr_error_at = str("last_member_mr_error_at");
  if (last_member_mr_error_at) out.last_member_mr_error_at = last_member_mr_error_at;
  const last_member_mr_error_message = str("last_member_mr_error_message");
  if (last_member_mr_error_message) out.last_member_mr_error_message = last_member_mr_error_message;
  const mr_member_help_requested_at = str("mr_member_help_requested_at");
  if (mr_member_help_requested_at) out.mr_member_help_requested_at = mr_member_help_requested_at;
  const mr_member_incident_note = str("mr_member_incident_note");
  if (mr_member_incident_note) out.mr_member_incident_note = mr_member_incident_note;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Indique si une étiquette MR déjà en base est encore valable pour le groupe `itemIds` affiché
 * (même ensemble que `mr_merge_item_ids`, aligné BO). Sinon l’UI doit repasser en « bordereau à recréer ».
 */
export function mondialRelayLabelMatchesItemGroup(
  itemIds: string[],
  m: ItemIntakeMondialRelayMetadata | null,
): boolean {
  if (m == null || !String(m.label_url ?? "").trim()) return false;
  const canonical = [...new Set(itemIds.map((id) => String(id).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const raw = String(m.mr_merge_item_ids ?? "").trim();
  const stored = new Set(raw ? raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : []);

  if (canonical.length < 2) {
    if (stored.size === 0) return true;
    if (canonical.length === 1 && stored.size === 1 && stored.has(canonical[0]!)) return true;
    return false;
  }

  if (stored.size !== canonical.length) return false;
  return canonical.every((id) => stored.has(id));
}

/** Extrait les UUID listés dans `metadata.mondial_relay.mr_merge_item_ids` (sans dédoublonner). */
export function parseMrMergeItemIdsFromIntakeMetadata(metadata: unknown): string[] {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const root = metadata as Record<string, unknown>;
  const raw = root.mondial_relay;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const m = raw as Record<string, unknown>;
  const s = m.mr_merge_item_ids;
  if (typeof s !== "string" || !s.trim()) return [];
  return [
    ...new Set(
      s
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * IDs à passer en query `ids` sur `/items/shipping` : si fusion BO (≥ 2 UUID valides), toutes les pièces du lot (+ l’item courant), triées, max 5.
 */
export function resolveShippingItemIdsForLink(itemId: string, metadata: unknown): string[] {
  const mergeRaw = parseMrMergeItemIdsFromIntakeMetadata(metadata);
  const validMerge = mergeRaw.filter((id) => SHIPPING_ITEM_ID_UUID_RE.test(id));
  if (validMerge.length < 2) {
    return SHIPPING_ITEM_ID_UUID_RE.test(itemId) ? [itemId] : validMerge.slice(0, 5);
  }
  const set = new Set(validMerge);
  if (SHIPPING_ITEM_ID_UUID_RE.test(itemId)) set.add(itemId);
  return [...set].sort().slice(0, 5);
}

/** Valeur du paramètre `ids` (chaque id encodé, séparés par des virgules). */
export function buildShippingIdsSearchParamsValue(itemId: string, metadata: unknown): string {
  const ids = resolveShippingItemIdsForLink(itemId, metadata);
  if (ids.length === 0) return encodeURIComponent(itemId.trim() || itemId);
  return ids.map(encodeURIComponent).join(",");
}
