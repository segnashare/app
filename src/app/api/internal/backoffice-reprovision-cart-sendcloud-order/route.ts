import { NextResponse } from "next/server";

import { reprovisionCartOutboundSendcloudOrder } from "@/lib/cart/reprovision-cart-outbound-sendcloud-order";
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
 * Recréation commande Sendcloud importée pour un panier confirmé (BO logistique).
 *
 * Auth : même Bearer que `backoffice-cancel-cart-order-pending`.
 * Body JSON : `{ "cart_id": "uuid" }`.
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

  let body: { cart_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const cartId = typeof body.cart_id === "string" ? body.cart_id.trim() : "";
  if (!isUuid(cartId)) {
    return NextResponse.json({ ok: false as const, error: "cart_id_invalid" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  try {
    const result = await reprovisionCartOutboundSendcloudOrder(admin, cartId);

    if (!result.ok) {
      const status =
        result.error === "cart_not_found"
          ? 404
          : result.error === "cart_not_confirmed" ||
              result.error === "outbound_shipment_not_found" ||
              result.error === "outbound_not_reprovisionable" ||
              result.error === "uber_direct_not_supported" ||
              result.error === "no_sendcloud_outbound_option"
            ? 409
            : result.error === "sendcloud_not_configured"
              ? 503
              : 502;

      if (result.notices.length > 0) {
        console.info("[internal/backoffice-reprovision-cart-sendcloud-order]", result.notices.join(" · "));
      }

      return NextResponse.json(
        { ok: false as const, error: result.error, notices: result.notices },
        { status },
      );
    }

    if ("skipped" in result && result.skipped) {
      return NextResponse.json({
        ok: true as const,
        skipped: true as const,
        reason: result.reason,
        notices: result.notices,
      });
    }

    const success = result as Extract<
      typeof result,
      { orderNumber: string; sendcloudPanelOrderId: string | null }
    >;

    if (success.notices.length > 0) {
      console.info("[internal/backoffice-reprovision-cart-sendcloud-order]", success.notices.join(" · "));
    }

    return NextResponse.json({
      ok: true as const,
      cart_id: cartId,
      sendcloud_order_number: success.orderNumber,
      sendcloud_panel_order_id: success.sendcloudPanelOrderId,
      sendcloud_label_generation: success.generation,
      cancelled_previous: success.cancelledPrevious,
      notices: success.notices,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[internal/backoffice-reprovision-cart-sendcloud-order]", msg);
    return NextResponse.json({ ok: false as const, error: "reprovision_failed", detail: msg.slice(0, 200) }, { status: 500 });
  }
}
