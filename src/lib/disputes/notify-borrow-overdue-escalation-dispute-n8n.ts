import type { SupabaseClient } from "@supabase/supabase-js";

import {
  notifyCartDisputeN8n,
  type CartDisputeN8nNotifyResult,
} from "@/lib/disputes/notify-cart-dispute-n8n";
import {
  maybeNotifyBorrowOverdueDayN8n,
  type BorrowOverdueDayN8nNotifyResult,
} from "@/lib/disputes/notify-borrow-overdue-day-n8n";
import type { BorrowOverdueAccrueResult } from "@/lib/emprunt/borrow-overdue-penalty";

export async function notifyBorrowOverdueEscalationDisputeN8n(
  admin: SupabaseClient,
  input: { cartId: string; disputeId: string },
): Promise<CartDisputeN8nNotifyResult> {
  const { data: dispute, error: disputeErr } = await admin
    .from("cart_disputes")
    .select("id, details, reason, status")
    .eq("id", input.disputeId)
    .eq("cart_id", input.cartId)
    .is("deleted_at", null)
    .maybeSingle();

  if (disputeErr || !dispute?.id) {
    console.error("[n8n/dispute-escalation] dispute lookup", disputeErr?.message ?? "not_found");
    return { ok: false, reason: "network_error", detail: "dispute_not_found" };
  }

  const { data: cart, error: cartErr } = await admin
    .from("carts")
    .select("user_id, status")
    .eq("id", input.cartId)
    .maybeSingle();

  if (cartErr || !cart?.user_id) {
    console.error("[n8n/dispute-escalation] cart lookup", cartErr?.message ?? "not_found");
    return { ok: false, reason: "network_error", detail: "cart_not_found" };
  }

  const { data: user } = await admin
    .from("users")
    .select("email")
    .eq("id", cart.user_id)
    .maybeSingle();

  const details =
    typeof dispute.details === "string" && dispute.details.trim()
      ? dispute.details.trim()
      : "Escalade automatique J+15 — retard de restitution.";

  return notifyCartDisputeN8n({
    cartId: input.cartId,
    disputeId: input.disputeId,
    userId: String(cart.user_id),
    userEmail: typeof user?.email === "string" ? user.email : null,
    details,
    category: "borrow_return_late",
    scope: "whole_cart",
    reportKind: "borrow",
    reason: String(dispute.reason ?? "borrow_return_overdue_escalation"),
    itemIds: [],
    photoPaths: [],
    cartStatus: typeof cart.status === "string" ? cart.status : null,
    updated: false,
  });
}

/** Après accrue RPC : notifie n8n uniquement si un litige d'escalade vient d'être créé. */
export async function maybeNotifyBorrowOverdueEscalationDisputeN8n(
  admin: SupabaseClient,
  cartId: string,
  accrue: BorrowOverdueAccrueResult | null | undefined,
): Promise<CartDisputeN8nNotifyResult | null> {
  if (accrue?.dispute_created !== true || !accrue.dispute_id?.trim()) {
    return null;
  }

  const result = await notifyBorrowOverdueEscalationDisputeN8n(admin, {
    cartId,
    disputeId: accrue.dispute_id.trim(),
  });

  if (!result.ok) {
    console.warn("[n8n/dispute-escalation] webhook failed", cartId, result);
  }

  return result;
}

/**
 * Après accrue RPC : Discord n8n chaque nouveau J+X, + litige escalade si créé (J+15).
 */
export async function maybeNotifyBorrowOverdueAccrueN8n(
  admin: SupabaseClient,
  cartId: string,
  calendarDate: string,
  accrue: BorrowOverdueAccrueResult | null | undefined,
): Promise<{
  day: BorrowOverdueDayN8nNotifyResult | null;
  escalation: CartDisputeN8nNotifyResult | null;
}> {
  const day = await maybeNotifyBorrowOverdueDayN8n(admin, cartId, calendarDate, accrue);
  const escalation = await maybeNotifyBorrowOverdueEscalationDisputeN8n(admin, cartId, accrue);
  return { day, escalation };
}
