import type { SupabaseClient } from "@supabase/supabase-js";

import { archiveItemChatForDisputeIds } from "@/lib/disputes/archive-dispute-item-chat";
import {
  cartDisputeKindFromReason,
  isCartDisputeKind,
  shouldReleaseCartToConfirmedWhenItemsSettled,
} from "@/lib/disputes/cart-dispute-kind";
import { buildCartDisputeOpsSoftGate } from "@/lib/disputes/cart-dispute-ops-soft-gate";
import { isCartTotalLossSettled } from "@/lib/disputes/is-cart-total-loss-settled";

/**
 * Quand tous les litiges pièce du dossier sont `resolved` / `closed`,
 * clôture le litige panier (`resolved`).
 * - Panier entièrement perdu → `archived` (historique membre).
 * - Sinon mid-rental → `confirmed` (location des autres pièces).
 */
export async function resolveCartDisputeWhenItemsTerminal(
  admin: SupabaseClient,
  cartDisputeId: string | null | undefined,
): Promise<{ resolved: boolean; totalLossArchived?: boolean }> {
  const disputeId = String(cartDisputeId ?? "").trim();
  if (!disputeId) return { resolved: false };

  const { data: dispute } = await admin
    .from("cart_disputes")
    .select("id, cart_id, status, reason, kind")
    .eq("id", disputeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!dispute?.id || !dispute.cart_id) return { resolved: false };
  const cartId = String(dispute.cart_id);

  const current = String(dispute.status ?? "");
  const nowIso = new Date().toISOString();

  /** Filet : litige déjà clos mais panier total-loss encore `confirmed`/`disputed`. */
  async function archiveTotalLossIfNeeded(): Promise<boolean> {
    const totalLoss = await isCartTotalLossSettled(admin, cartId);
    if (!totalLoss) return false;
    const { data: updated, error: archiveErr } = await admin
      .from("carts")
      .update({ status: "archived", updated_at: nowIso })
      .eq("id", cartId)
      .in("status", ["disputed", "confirmed"])
      .select("id")
      .maybeSingle();
    if (archiveErr) {
      console.error("[resolve-cart-dispute-when-items-terminal] archive", archiveErr.message);
      return false;
    }
    if (updated?.id) {
      await archiveItemChatForDisputeIds(admin, [disputeId]);
      return true;
    }
    return false;
  }

  if (current === "closed" || current === "resolved") {
    const archived = await archiveTotalLossIfNeeded();
    return archived ? { resolved: true, totalLossArchived: true } : { resolved: false };
  }

  const { data: itemRows } = await admin
    .from("item_disputes")
    .select("status")
    .eq("cart_dispute_id", disputeId)
    .is("deleted_at", null);

  const statuses = (itemRows ?? []).map((r: { status?: unknown }) => String(r.status ?? "open"));
  if (statuses.length === 0) return { resolved: false };
  const allTerminal = statuses.every((s) => s === "resolved" || s === "closed");
  if (!allTerminal) return { resolved: false };

  const { error } = await admin
    .from("cart_disputes")
    .update({
      status: "resolved",
      ops_soft_gate: buildCartDisputeOpsSoftGate({ active: false }),
      updated_at: nowIso,
    })
    .eq("id", disputeId)
    .in("status", ["open", "in_review"]);
  if (error) {
    console.error("[resolve-cart-dispute-when-items-terminal]", error.message);
    return { resolved: false };
  }

  const kind =
    typeof dispute.kind === "string" && isCartDisputeKind(dispute.kind)
      ? dispute.kind
      : cartDisputeKindFromReason(typeof dispute.reason === "string" ? dispute.reason : null);

  if (await archiveTotalLossIfNeeded()) {
    return { resolved: true, totalLossArchived: true };
  }

  if (shouldReleaseCartToConfirmedWhenItemsSettled(kind)) {
    await admin
      .from("carts")
      .update({ status: "confirmed", updated_at: nowIso })
      .eq("id", cartId)
      .eq("status", "disputed");
  }

  return { resolved: true };
}
