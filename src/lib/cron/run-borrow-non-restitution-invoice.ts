import type { SupabaseClient } from "@supabase/supabase-js";

import { sendBorrowNonRestitutionInvoiceForCart } from "@/lib/borrow-non-restitution/send-borrow-non-restitution-invoice";
import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";

const MAX_OVERDUE = 200;

type OverdueRow = {
  id: string;
  cart_id: string;
  user_id: string;
  formal_notice_deadline_at: string | null;
  recovery_phase: string | null;
};

/**
 * Cron post-deadline MED : facture Stripe (valeur panier + frais traitement).
 * Smart Retries Stripe — pas de recovery manuelle Segna.
 */
export async function runBorrowNonRestitutionInvoice(
  admin: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<{
  scanned: number;
  invoiced: number;
  skipped: number;
  errors: number;
  reasons: Record<string, number>;
}> {
  const nowIso = new Date(nowMs).toISOString();

  const { data: overdueRows, error } = await admin
    .from("cart_borrow_overdue")
    .select("id,cart_id,user_id,formal_notice_deadline_at,recovery_phase")
    .in("status", ["active", "escalated"])
    .not("formal_notice_sent_at", "is", null)
    .lt("formal_notice_deadline_at", nowIso)
    .in("recovery_phase", ["formal_notice_sent"])
    .order("formal_notice_deadline_at", { ascending: true })
    .limit(MAX_OVERDUE);

  if (error) throw new Error(error.message);

  const rows = (overdueRows ?? []) as OverdueRow[];
  if (rows.length === 0) {
    return { scanned: 0, invoiced: 0, skipped: 0, errors: 0, reasons: {} };
  }

  const cartIds = [...new Set(rows.map((r) => r.cart_id))];

  const { data: retRows } = await admin
    .from("shipments")
    .select("cart_id,status,updated_at")
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .in("cart_id", cartIds);

  const latestReturnByCart = new Map<string, string>();
  for (const row of (retRows ?? []) as { cart_id?: string; status?: string; updated_at?: string }[]) {
    const cid = row.cart_id ?? "";
    const st = row.status ?? "";
    const ut = row.updated_at ?? "";
    if (!cid) continue;
    const prev = latestReturnByCart.get(cid);
    if (!prev || new Date(ut) > new Date(prev)) {
      latestReturnByCart.set(cid, st);
    }
  }

  const { data: chargeRows } = await admin
    .from("cart_borrow_non_restitution_charges")
    .select("overdue_id")
    .in(
      "overdue_id",
      rows.map((r) => r.id),
    );

  const chargedOverdueIds = new Set(
    ((chargeRows ?? []) as { overdue_id?: string }[]).map((r) => r.overdue_id).filter(Boolean),
  );

  let scanned = 0;
  let invoiced = 0;
  let skipped = 0;
  let errors = 0;
  const reasons: Record<string, number> = {};

  const bump = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  for (const overdue of rows) {
    scanned++;

    if (chargedOverdueIds.has(overdue.id)) {
      skipped++;
      bump("charge_row_exists");
      continue;
    }

    const retStatus = latestReturnByCart.get(overdue.cart_id);
    if (retStatus && isCartReturnCommitmentMet(retStatus)) {
      skipped++;
      bump("return_commitment_met");
      continue;
    }

    const result = await sendBorrowNonRestitutionInvoiceForCart(admin, {
      cartId: overdue.cart_id,
      nowMs,
    });

    if (result.ok) {
      invoiced++;
      chargedOverdueIds.add(overdue.id);
    } else {
      if (
        result.reason === "already_charged" ||
        result.reason === "charge_row_exists" ||
        result.reason === "formal_notice_deadline_not_passed" ||
        result.reason === "return_commitment_met"
      ) {
        skipped++;
      } else {
        errors++;
        console.error("[borrow-non-restitution] cron", overdue.cart_id, result.reason);
      }
      bump(result.reason);
    }
  }

  return { scanned, invoiced, skipped, errors, reasons };
}
