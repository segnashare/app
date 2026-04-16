import { NextResponse } from "next/server";

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

  const { data, error } = await supabase.rpc("member_cancel_cart_order_pending_preparation", {
    p_cart_id: cartId,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("CART_CANCEL_STRIPE_PAYMENT_RECORDED")) {
      return NextResponse.json(
        {
          error:
            "Cette commande inclut un paiement carte enregistré. L’annulation automatique n’est pas disponible — contacte le support Segna.",
        },
        { status: 409 },
      );
    }
    if (msg.includes("SHIPMENT_NOT_PENDING")) {
      return NextResponse.json(
        { error: "La commande ne peut plus être annulée : l’expédition a déjà démarré." },
        { status: 409 },
      );
    }
    if (msg.includes("CART_NOT_CANCELLABLE_STATUS")) {
      return NextResponse.json({ error: "Cette commande ne peut pas être annulée dans son état actuel." }, { status: 409 });
    }
    if (msg.includes("FORBIDDEN") || msg.includes("CART_NOT_FOUND")) {
      return NextResponse.json({ error: "Commande introuvable ou accès refusé." }, { status: 403 });
    }
    console.error("[api/cart/order/cancel]", msg);
    return NextResponse.json({ error: "Annulation impossible pour le moment. Réessaie ou contacte le support." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: data ?? null });
}
