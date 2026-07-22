import type { SupabaseClient } from "@supabase/supabase-js";

import {
  notifyCartDisputeN8n,
  type CartDisputeN8nNotifyResult,
} from "@/lib/disputes/notify-cart-dispute-n8n";
import type { BorrowOverdueAccrueResult } from "@/lib/emprunt/borrow-overdue-penalty";

export type BorrowOverdueDayN8nNotifyResult = CartDisputeN8nNotifyResult;

function formatEurosFromCents(cents: number): string {
  return `${(Math.max(0, cents) / 100).toFixed(2).replace(".", ",")} €`;
}

/**
 * Discord ops via le webhook litiges (`N8N_DISPUTE_WEBHOOK_URL`),
 * pour chaque jour de retard nouvellement journalisé.
 *
 * Réutilise `event: cart_dispute_opened` pour le workflow n8n existant ;
 * `reason: borrow_return_overdue_day` permet de filtrer / formater côté n8n.
 */
export async function notifyBorrowOverdueDayN8n(
  admin: SupabaseClient,
  input: {
    cartId: string;
    calendarDate: string;
    accrue: BorrowOverdueAccrueResult;
  },
): Promise<BorrowOverdueDayN8nNotifyResult> {
  const lateDay = Math.max(1, Math.trunc(Number(input.accrue.late_day ?? 1)));
  const penaltyCents = Math.max(0, Math.trunc(Number(input.accrue.penalty_cents ?? 0)));
  const chargeStatus =
    typeof input.accrue.charge_status === "string" && input.accrue.charge_status.trim()
      ? input.accrue.charge_status.trim()
      : "pending";

  const { data: cart, error: cartErr } = await admin
    .from("carts")
    .select("user_id, status")
    .eq("id", input.cartId)
    .maybeSingle();

  if (cartErr || !cart?.user_id) {
    console.error("[n8n/borrow-overdue-day] cart lookup", cartErr?.message ?? "not_found");
    return { ok: false, reason: "network_error", detail: "cart_not_found" };
  }

  const [{ data: user }, { data: overdue }] = await Promise.all([
    admin.from("users").select("email").eq("id", cart.user_id).maybeSingle(),
    admin
      .from("cart_borrow_overdue")
      .select("id, penalties_accrued_cents, cart_dispute_id")
      .eq("cart_id", input.cartId)
      .in("status", ["active", "escalated"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const accruedCents = Math.max(
    0,
    Math.trunc(Number(overdue?.penalties_accrued_cents ?? penaltyCents)),
  );

  const details =
    `Retard restitution J+${lateDay} (${input.calendarDate}) — ` +
    `pénalité du jour ${formatEurosFromCents(penaltyCents)}` +
    (chargeStatus !== "charged" ? ` · prélèvement ${chargeStatus}` : " · prélevé") +
    ` · cumul ${formatEurosFromCents(accruedCents)}.`;

  /** Identifiant stable pour le message Discord (jour accrû, sinon overdue / panier). */
  const notifyId =
    (typeof input.accrue.day_id === "string" && input.accrue.day_id.trim()) ||
    (typeof overdue?.cart_dispute_id === "string" && overdue.cart_dispute_id.trim()) ||
    (typeof overdue?.id === "string" && overdue.id.trim()) ||
    input.cartId;

  return notifyCartDisputeN8n({
    cartId: input.cartId,
    disputeId: notifyId,
    userId: String(cart.user_id),
    userEmail: typeof user?.email === "string" ? user.email : null,
    details,
    category: "borrow_return_late",
    scope: "whole_cart",
    reportKind: "borrow",
    reason: "borrow_return_overdue_day",
    itemIds: [],
    photoPaths: [],
    cartStatus: typeof cart.status === "string" ? cart.status : null,
    updated: false,
  });
}

/** Après accrue RPC : Discord n8n une fois par nouveau jour de retard. */
export async function maybeNotifyBorrowOverdueDayN8n(
  admin: SupabaseClient,
  cartId: string,
  calendarDate: string,
  accrue: BorrowOverdueAccrueResult | null | undefined,
): Promise<BorrowOverdueDayN8nNotifyResult | null> {
  if (accrue?.applied !== true || accrue.duplicate === true) {
    return null;
  }

  const result = await notifyBorrowOverdueDayN8n(admin, {
    cartId,
    calendarDate,
    accrue,
  });

  if (!result.ok) {
    console.warn("[n8n/borrow-overdue-day] webhook failed", cartId, result);
  }

  return result;
}
