import { NextResponse } from "next/server";

import { sendBorrowFormalNoticeForCart } from "@/lib/borrow-formal-notice/send-borrow-formal-notice";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  cart_id?: string;
  /** Ignore le seuil J+21. */
  force?: boolean;
  /** Simule AR24 (dev, sans credentials). */
  dry_run?: boolean;
  /** Supprime le log notif complémentaire avant envoi (re-test). */
  force_notify?: boolean;
};

/**
 * Dev uniquement : envoi MED AR24 pour un panier.
 *
 * POST /api/dev/send-borrow-formal-notice
 * Body: { cart_id, force?, force_notify? }
 *
 * Dry-run AR24 : SEGNA_BORROW_FORMAL_NOTICE_DRY_RUN=1 (sans credentials AR24).
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

  if (body.force_notify === true) {
    await admin
      .from("notification_send_log")
      .delete()
      .eq("idempotency_key", `txn:borrow_formal_notice:${cartId}`);
  }

  const result = await sendBorrowFormalNoticeForCart(admin, {
    cartId,
    force: body.force === true,
    dryRun: body.dry_run === true,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  const { data: notice } = await admin
    .from("cart_borrow_formal_notices")
    .select("id,sent_at,deadline_at,ar24_message_id,ar24_status")
    .eq("id", result.formalNoticeId)
    .maybeSingle();

  return NextResponse.json({
    ...result,
    notice: notice ?? null,
    note: result.dryRun
      ? "Dry-run AR24 (SEGNA_BORROW_FORMAL_NOTICE_DRY_RUN=1). Vérifie cart_borrow_formal_notices + e-mail complémentaire."
      : "MED AR24 + notif complémentaire Resend/SMS.",
  });
}
