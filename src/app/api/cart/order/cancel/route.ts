import { NextResponse } from "next/server";
import Stripe from "stripe";

import { refundCartOrderStripePaymentIfNeeded } from "@/lib/stripe/refund-cart-order-checkout-payment";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const cartId = typeof (body as { cartId?: unknown })?.cartId === "string" ? (body as { cartId: string }).cartId : "";
  if (!CART_ID_RE.test(cartId)) {
    return NextResponse.json({ error: "Identifiant de commande invalide" }, { status: 400 });
  }

  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { data: shipSummary, error: shipErr } = await supabase.rpc("get_cart_outbound_shipment_summary", {
    p_cart_id: cartId,
  });
  if (shipErr) {
    console.error("[api/cart/order/cancel] get_cart_outbound_shipment_summary", shipErr.message);
    return NextResponse.json({ error: "Lecture expédition impossible. Réessaie." }, { status: 500 });
  }
  const shipJson = shipSummary as Record<string, unknown> | null;
  const shipSt = typeof shipJson?.status === "string" ? shipJson.status.toLowerCase().trim() : "";
  const outboundCancelable = shipSt === "pending" || shipSt === "ready";
  if (!shipJson || !outboundCancelable) {
    const label = shipSt || "inconnu";
    return NextResponse.json(
      {
        error: `Annulation impossible : l’expédition n’est plus annulable en ligne (statut « ${label} »). Tu peux annuler tant qu’elle est en préparation ou prête à l’expédition, avant prise en charge par le transporteur.`,
      },
      { status: 409 },
    );
  }

  const { data: invoiceRaw, error: invErr } = await supabase.rpc("get_member_cart_order_stripe_invoice", {
    p_cart_id: cartId,
  });
  if (invErr) {
    console.error("[api/cart/order/cancel] get_member_cart_order_stripe_invoice", invErr.message);
    return NextResponse.json({ error: "Lecture paiement impossible. Réessaie." }, { status: 500 });
  }

  const invoice =
    invoiceRaw != null && typeof invoiceRaw === "object" && !Array.isArray(invoiceRaw)
      ? (invoiceRaw as Record<string, unknown>)
      : null;

  const cents = Math.trunc(Number(invoice?.amount_total_cents ?? 0));
  if (cents > 0) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      console.error("[api/cart/order/cancel] STRIPE_SECRET_KEY missing");
      return NextResponse.json({ error: "Configuration serveur incomplète." }, { status: 500 });
    }
    const stripe = new Stripe(secretKey);
    const refundRes = await refundCartOrderStripePaymentIfNeeded({
      stripe,
      cartId,
      invoice,
    });
    if (!refundRes.ok) {
      return NextResponse.json({ error: refundRes.error }, { status: 502 });
    }
  }

  const { data, error } = await supabase.rpc("member_cancel_cart_order_pending_preparation", {
    p_cart_id: cartId,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("SHIPMENT_NOT_PENDING")) {
      const m = /SHIPMENT_NOT_PENDING:?\s*(\w+)/i.exec(msg);
      const reported = (m?.[1] ?? "").toLowerCase().trim();
      const isLikelyOldRpcBlockingReady =
        reported === "ready" || (reported !== "" && reported !== "pending" && shipSt === "ready");
      const migrationHint = isLikelyOldRpcBlockingReady
        ? " La base doit autoriser aussi le statut « ready » : applique la migration `20260627080000_member_cancel_outbound_pending_or_ready.sql` (Supabase `db push` / `migration up`), puis réessaie."
        : "";
      return NextResponse.json(
        {
          error: `Annulation refusée par le serveur (expédition : ${reported || "statut inconnu"}).${migrationHint}`.trim(),
        },
        { status: 409 },
      );
    }
    if (msg.includes("CART_NOT_CANCELLABLE_STATUS")) {
      return NextResponse.json({ error: "Cette commande ne peut pas être annulée dans son état actuel." }, { status: 409 });
    }
    if (msg.includes("FORBIDDEN") || msg.includes("CART_NOT_FOUND")) {
      return NextResponse.json({ error: "Commande introuvable ou accès refusé." }, { status: 403 });
    }
    if (msg.includes("OUTBOUND_SHIPMENT_NOT_FOUND")) {
      return NextResponse.json(
        { error: "Expédition introuvable pour cette commande. Réessaie ou contacte le support." },
        { status: 409 },
      );
    }
    if (msg.includes("CART_DEBIT_NOT_FOUND")) {
      return NextResponse.json(
        {
          error:
            "Annulation impossible : débit wallet panier introuvable (données incomplètes). Contacte le support avec ton numéro de commande.",
        },
        { status: 409 },
      );
    }
    if (msg.includes("CART_DEBIT_SPLIT_MISMATCH")) {
      return NextResponse.json(
        { error: "Annulation impossible : incohérence sur les crédits prélevés. Contacte le support." },
        { status: 409 },
      );
    }
    if (msg.includes("CART_CANCEL_STRIPE_PAYMENT_RECORDED")) {
      console.error(
        "[api/cart/order/cancel] CART_CANCEL_STRIPE_PAYMENT_RECORDED — appliquer la migration 20260626220000_member_cancel_cart_order_allow_stripe_paid.sql",
      );
      return NextResponse.json(
        {
          error:
            "L’annulation avec paiement carte n’est pas prise en charge par la base actuelle. Mets à jour les migrations Segna ou contacte le support.",
        },
        { status: 503 },
      );
    }
    console.error("[api/cart/order/cancel]", msg);
    return NextResponse.json({ error: "Annulation impossible pour le moment. Réessaie ou contacte le support." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: data ?? null });
}
