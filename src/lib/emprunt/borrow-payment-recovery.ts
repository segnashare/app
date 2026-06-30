import type { SupabaseClient } from "@supabase/supabase-js";

import type { BorrowOverdueRecoveryStatus } from "@/lib/emprunt/borrow-overdue-recovery-phase";

const SKIP_PAYMENT_RECOVERY_ERRORS = new Set([
  "nothing_to_settle",
  "amount_below_stripe_minimum",
  "stripe_charge_disabled",
  "no_stripe_customer",
  "no_payment_method",
]);

/** Erreurs Stripe off-session nécessitant une action membre (SCA, carte refusée, etc.). */
export function classifyBorrowOverdueStripeChargeFailure(
  error: string | null | undefined,
): BorrowOverdueRecoveryStatus | null {
  const msg = String(error ?? "").trim().toLowerCase();
  if (!msg || SKIP_PAYMENT_RECOVERY_ERRORS.has(msg)) return null;

  if (
    msg.includes("requires_action") ||
    msg.includes("authentication_required") ||
    msg.includes("payment_intent_authentication_failure") ||
    msg === "payment_intent_requires_action"
  ) {
    return "requires_action";
  }

  return "recovery_required";
}

async function findOpenOverdueId(admin: SupabaseClient, cartId: string): Promise<string | null> {
  const { data } = await admin
    .from("cart_borrow_overdue")
    .select("id")
    .eq("cart_id", cartId)
    .in("status", ["active", "escalated"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as { id?: string } | null)?.id ?? null;
}

/** Passe le dossier en `payment_recovery` après échec de prélèvement (pas de suspension auth auto). */
export async function enterBorrowPaymentRecovery(
  admin: SupabaseClient,
  input: { cartId: string; chargeError?: string | null },
): Promise<void> {
  const recoveryStatus = classifyBorrowOverdueStripeChargeFailure(input.chargeError);
  if (!recoveryStatus) return;

  const overdueId = await findOpenOverdueId(admin, input.cartId);
  if (!overdueId) return;

  const nowIso = new Date().toISOString();
  await admin
    .from("cart_borrow_overdue")
    .update({
      recovery_phase: "payment_recovery",
      recovery_status: recoveryStatus,
      updated_at: nowIso,
    })
    .eq("id", overdueId);
}

/** Remet le statut recovery à `none` quand les pénalités impayées sont soldées. */
export async function clearBorrowPaymentRecoveryIfSettled(
  admin: SupabaseClient,
  cartId: string,
): Promise<void> {
  const { data: unpaidRows } = await admin
    .from("cart_borrow_overdue_days")
    .select("id")
    .eq("cart_id", cartId)
    .in("charge_status", ["pending", "failed"])
    .limit(1);

  if ((unpaidRows ?? []).length > 0) return;

  const overdueId = await findOpenOverdueId(admin, cartId);
  if (!overdueId) return;

  const { data: overdue } = await admin
    .from("cart_borrow_overdue")
    .select("recovery_phase, recovery_status")
    .eq("id", overdueId)
    .maybeSingle();

  const phase = String((overdue as { recovery_phase?: string } | null)?.recovery_phase ?? "");
  const status = String((overdue as { recovery_status?: string } | null)?.recovery_status ?? "");

  if (phase !== "payment_recovery" && status === "none") return;

  const nowIso = new Date().toISOString();
  const patch: Record<string, string> = {
    recovery_status: "none",
    updated_at: nowIso,
  };

  if (phase === "payment_recovery") {
    patch.recovery_phase = "app_restricted";
  }

  await admin.from("cart_borrow_overdue").update(patch).eq("id", overdueId);
}
