import { NextResponse } from "next/server";

import {
  resetBorrowNonRestitutionDryRunForCart,
  sendBorrowNonRestitutionInvoiceForCart,
} from "@/lib/borrow-non-restitution/send-borrow-non-restitution-invoice";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  cart_id?: string;
  force?: boolean;
  dry_run?: boolean;
  resend_stripe_email?: boolean;
};

/**
 * Dev : émet facture Stripe non-restitution pour un panier (post-deadline MED).
 *
 * POST /api/dev/send-borrow-non-restitution-invoice
 * Body: { cart_id, force?, dry_run? }
 *
 * Dry-run : SEGNA_BORROW_NON_RESTITUTION_DRY_RUN=1 (sans appel Stripe).
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ ok: false, error: "dev_only" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const cartId = String(body.cart_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(cartId)) {
    return NextResponse.json({ ok: false, error: "invalid_cart_id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const dryRun =
    body.dry_run === true || process.env.SEGNA_BORROW_NON_RESTITUTION_DRY_RUN === "1";

  let devReset: { reset: boolean; reason?: string } | null = null;
  if (body.force === true) {
    devReset = await resetBorrowNonRestitutionDryRunForCart(admin, cartId);
  }

  const result = await sendBorrowNonRestitutionInvoiceForCart(admin, {
    cartId,
    force: body.force === true,
    dryRun,
    resendStripeEmail: body.resend_stripe_email === true,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }

  const { data: charge } = await admin
    .from("cart_borrow_non_restitution_charges")
    .select("id,status,stripe_invoice_id,stripe_invoice_hosted_url,amount_cents,unpaid_penalty_cents")
    .eq("cart_id", cartId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    ...result,
    charge,
    dev_reset: devReset,
    note: dryRun
      ? "Dry-run Stripe (SEGNA_BORROW_NON_RESTITUTION_DRY_RUN=1). Vérifie cart_borrow_non_restitution_charges."
      : "Facture Stripe finalisée — Smart Retries actifs côté Stripe Dashboard.",
  });
}
