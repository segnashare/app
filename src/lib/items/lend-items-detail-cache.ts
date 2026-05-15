import type { ItemDetailPayload } from "@/lib/items/fetch-item-detail-core";
import { fetchItemDetailDataForOwner } from "@/lib/items/fetch-item-detail-client";

const CACHE_TTL_MS = 12 * 60 * 1000;

const cache = new Map<string, { payload: ItemDetailPayload; at: number }>();
const inflight = new Map<string, Promise<ItemDetailPayload | null>>();

export function readLendItemDetailCache(itemId: string): ItemDetailPayload | null {
  const row = cache.get(itemId);
  if (!row) return null;
  if (Date.now() - row.at > CACHE_TTL_MS) {
    cache.delete(itemId);
    return null;
  }
  return row.payload;
}

export function primeLendItemDetailCache(itemId: string, payload: ItemDetailPayload): void {
  cache.set(itemId, { payload, at: Date.now() });
  if (typeof window !== "undefined") {
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("segna:item-detail-cached", { detail: { itemId } }));
    });
  }
}

export function invalidateLendItemDetailCache(itemId: string): void {
  cache.delete(itemId);
  inflight.delete(itemId);
}

/**
 * Précharge une fiche (idempotent, dédoublonné par `item_id`).
 * Utilisé depuis /exchange pour afficher les pièces « prêts » sans écran Chargement… à chaque clic.
 */
export function prefetchLendItemDetailIfNeeded(itemId: string): Promise<ItemDetailPayload | null> {
  const cached = readLendItemDetailCache(itemId);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(itemId);
  if (existing) return existing;

  const p = fetchItemDetailDataForOwner(itemId).then((r) => {
    inflight.delete(itemId);
    if (r.ok) primeLendItemDetailCache(itemId, r.payload);
    return r.ok ? r.payload : null;
  });
  inflight.set(itemId, p);
  return p;
}
