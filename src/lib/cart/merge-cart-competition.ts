/** Réponse RPC `get_cart_items_competition_state`. */
export type CartItemCompetitionRpcRow = {
  item_id: string;
  other_shoppers_in_cart: number;
  reserved_by_other: boolean;
  reserved_until_at?: string | null;
};

function parseReservedUntilAt(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

/** PostgREST peut renvoyer du jsonb déjà parsé ou une chaîne JSON. */
function normalizeCompetitionRpcPayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  return payload;
}

function parseCompetitionPayload(
  payload: unknown,
): Map<string, { otherShoppersInCart: number; reservedByOther: boolean; reservedUntilAt: string | null }> {
  const map = new Map<string, { otherShoppersInCart: number; reservedByOther: boolean; reservedUntilAt: string | null }>();
  const normalized = normalizeCompetitionRpcPayload(payload);
  if (!Array.isArray(normalized)) return map;
  for (const row of normalized) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.item_id === "string" ? r.item_id : null;
    if (!id) continue;
    map.set(id, {
      otherShoppersInCart: Math.max(0, Math.floor(Number(r.other_shoppers_in_cart ?? 0))),
      reservedByOther: Boolean(r.reserved_by_other),
      reservedUntilAt: parseReservedUntilAt(r.reserved_until_at),
    });
  }
  return map;
}

export function mergeCompetitionIntoCartLines<T extends { itemId: string }>(
  lines: T[],
  rpcPayload: unknown,
): (T & { otherShoppersInCart: number; reservedByOther: boolean; reservedUntilAt: string | null })[] {
  const comp = parseCompetitionPayload(rpcPayload);
  return lines.map((line) => {
    const c = comp.get(line.itemId) ?? {
      otherShoppersInCart: 0,
      reservedByOther: false,
      reservedUntilAt: null as string | null,
    };
    return {
      ...line,
      otherShoppersInCart: c.otherShoppersInCart,
      reservedByOther: c.reservedByOther,
      reservedUntilAt: c.reservedUntilAt,
    };
  });
}
