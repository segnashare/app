import { NextResponse } from "next/server";
import Stripe from "stripe";

import { NotificationKind } from "@/lib/notifications/kinds";
import { sendMemberOutreachNotification } from "@/lib/notifications/member-outreach";
import { refundCartOrderStripePaymentIfNeeded } from "@/lib/stripe/refund-cart-order-checkout-payment";
import { cancelCartOutboundSendcloudOrder } from "@/lib/cart/cancel-cart-outbound-sendcloud-order";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function internalBackofficeCartCancelSecrets(): string[] {
  const dedicated = process.env.SEGNA_INTERNAL_BACKOFFICE_CART_CANCEL_SECRET?.trim() ?? "";
  const ship = process.env.SEGNA_INTERNAL_SHIPMENT_LIFECYCLE_SECRET?.trim() ?? "";
  const uber = process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ?? "";
  return [...new Set([dedicated, ship, uber].filter(Boolean))];
}

/**
 * Annulation depuis le back-office : panier confirmé, expédition aller **pending** (« En préparation »).
 * Annulation DB puis remboursement carte (Stripe), RPC `backoffice_cancel_cart_order_pending_preparation`, puis e-mail + SMS membre.
 *
 * Auth : `Authorization: Bearer` = `SEGNA_INTERNAL_BACKOFFICE_CART_CANCEL_SECRET` si défini, sinon les mêmes secrets que
 * `shipment-lifecycle-notify` / lancement Uber.
 *
 * Body JSON : `{ "cart_id": "uuid", "actor_user_id": "uuid" }` (`actor_user_id` optionnel, journal `cart_status_history`).
 */
export async function POST(request: Request) {
  const candidates = internalBackofficeCartCancelSecrets();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false as const, error: "internal_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { cart_id?: unknown; actor_user_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const cartId = typeof body.cart_id === "string" ? body.cart_id.trim() : "";
  const actorRaw = typeof body.actor_user_id === "string" ? body.actor_user_id.trim() : "";
  const actorUserId = actorRaw && isUuid(actorRaw) ? actorRaw : null;

  if (!isUuid(cartId)) {
    return NextResponse.json({ ok: false as const, error: "cart_id_invalid" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: cart, error: cartErr } = await admin
    .from("carts")
    .select("id, user_id, status")
    .eq("id", cartId)
    .is("deleted_at", null)
    .maybeSingle();

  if (cartErr) {
    console.error("[internal/backoffice-cancel-cart-order-pending] cart", cartErr.message);
    return NextResponse.json({ ok: false as const, error: "cart_read_failed" }, { status: 500 });
  }

  const cartRow = cart as { id: string; user_id: string; status: string } | null;
  if (!cartRow) {
    return NextResponse.json({ ok: false as const, error: "cart_not_found" }, { status: 404 });
  }

  if (cartRow.status === "canceled") {
    return NextResponse.json({ ok: true as const, skipped: true as const, reason: "already_canceled" });
  }

  if (cartRow.status !== "confirmed") {
    return NextResponse.json(
      { ok: false as const, error: "cart_not_confirmed", status: cartRow.status },
      { status: 409 },
    );
  }

  const userId = cartRow.user_id;

  const { data: ships, error: shipErr } = await admin
    .from("shipments")
    .select("id, status, created_at")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (shipErr) {
    console.error("[internal/backoffice-cancel-cart-order-pending] shipment", shipErr.message);
    return NextResponse.json({ ok: false as const, error: "shipment_read_failed" }, { status: 500 });
  }

  const ship = (ships ?? [])[0] as { id: string; status: string } | undefined;
  if (!ship) {
    return NextResponse.json({ ok: false as const, error: "outbound_shipment_not_found" }, { status: 409 });
  }

  if (ship.status !== "pending") {
    return NextResponse.json(
      {
        ok: false as const,
        error: "outbound_not_pending_preparation",
        shipment_status: ship.status,
      },
      { status: 409 },
    );
  }

  const { data: invRow, error: invErr } = await admin
    .from("cart_order_stripe_invoices")
    .select(
      "amount_total_cents, payment_intent_id, checkout_session_id, credits_line_cents, service_ttc_cents, shipping_ttc_cents, fees_ttc_cents, fees_vat_cents, currency, created_at",
    )
    .eq("cart_id", cartId)
    .eq("user_id", userId)
    .maybeSingle();

  if (invErr) {
    console.error("[internal/backoffice-cancel-cart-order-pending] invoice", invErr.message);
    return NextResponse.json({ ok: false as const, error: "invoice_read_failed" }, { status: 500 });
  }

  const invoice = invRow as Record<string, unknown> | null;

  const { data: rpcData, error: rpcErr } = await admin.rpc("backoffice_cancel_cart_order_pending_preparation", {
    p_cart_id: cartId,
    p_actor_user_id: actorUserId,
  });

  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    console.error("[internal/backoffice-cancel-cart-order-pending] rpc", msg);
    if (msg.includes("SHIPMENT_NOT_PENDING")) {
      return NextResponse.json({ ok: false as const, error: "shipment_state_changed", detail: msg }, { status: 409 });
    }
    if (msg.includes("CART_NOT_CANCELLABLE") || msg.includes("CART_DEBIT")) {
      return NextResponse.json({ ok: false as const, error: "cancel_rejected", detail: msg }, { status: 409 });
    }
    if (msg.includes("FORBIDDEN_NOT_SERVICE_ROLE")) {
      return NextResponse.json({ ok: false as const, error: "rpc_forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: false as const, error: "cancel_failed", detail: msg.slice(0, 200) }, { status: 500 });
  }

  const cents = Math.trunc(Number(invoice?.amount_total_cents ?? 0));
  if (cents > 0) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      console.error("[internal/backoffice-cancel-cart-order-pending] STRIPE_SECRET_KEY missing");
      return NextResponse.json({ ok: false as const, error: "stripe_not_configured" }, { status: 500 });
    }
    const stripe = new Stripe(secretKey);
    const refundRes = await refundCartOrderStripePaymentIfNeeded({
      stripe,
      cartId,
      invoice,
    });
    if (!refundRes.ok) {
      return NextResponse.json({ ok: false as const, error: refundRes.error }, { status: 502 });
    }
  }

  try {
    const scCancel = await cancelCartOutboundSendcloudOrder(admin, cartId);
    if (scCancel.notices.length > 0) {
      console.info("[internal/backoffice-cancel-cart-order-pending] sendcloud", scCancel.notices.join(" · "));
    }
  } catch (e) {
    console.error("[internal/backoffice-cancel-cart-order-pending] sendcloud cancel", e);
  }

  const idempotencyKey = `txn:${NotificationKind.cartOrderCanceledBackofficePrep}:${cartId}`;
  const smsBody =
    "Segna : ta commande en préparation a été annulée avant expédition. Le remboursement (points + complément carte le cas échéant) est en cours. Toutes nos excuses pour la gêne.";

  await sendMemberOutreachNotification(admin, {
    userId,
    kind: NotificationKind.cartOrderCanceledBackofficePrep,
    idempotencyKey,
    metadata: { cart_id: cartId, source: "backoffice_cancel_pending_preparation" },
    subject: "Annulation de ta commande Segna",
    text: [
      "Bonjour,",
      "",
      "Ta commande Segna a dû être annulée alors qu’elle était encore en préparation, avant expédition.",
      "Le remboursement de tes points et, le cas échéant, du complément payé par carte est en cours.",
      "",
      "Toutes nos excuses pour ce désagrément.",
      "",
      "L’équipe Segna",
    ].join("\n"),
    html: `<p>Bonjour,</p>
<p>Ta commande Segna a dû être <strong>annulée</strong> alors qu’elle était encore <strong>en préparation</strong>, avant expédition.</p>
<p>Le remboursement de tes points et, le cas échéant, du complément payé par carte est <strong>en cours</strong>.</p>
<p>Toutes nos excuses pour ce désagrément.</p>
<p>L’équipe Segna</p>`,
    channels: "email+phone",
    smsBody,
    transactionalSms: true,
  });

  return NextResponse.json({ ok: true as const, cart_id: cartId, rpc: rpcData ?? null });
}
