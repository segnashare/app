import { NextResponse } from "next/server";

import { createBorrowOverdueCheckoutSession } from "@/lib/stripe/borrow-overdue-checkout";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasBearer(request: Request): boolean {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  return auth.toLowerCase().startsWith("bearer ") && auth.length > 7;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { cartId?: unknown } | null;
    const cartId = typeof body?.cartId === "string" ? body.cartId.trim() : "";
    if (!CART_ID_RE.test(cartId)) {
      return NextResponse.json({ message: "Panier invalide." }, { status: 400 });
    }

    const bearerPresent = hasBearer(request);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bearer (mobile) ou cookies (web)
    const { user, error: userError } = (await resolveRequestUserClient(request)) as any;
    const admin = createSupabaseAdminClient();

    if (userError || !user) {
      const errMsg = userError instanceof Error ? userError.message : String(userError ?? "none");
      console.warn(
        `[borrow-overdue/checkout] auth failed bearer=${bearerPresent ? "yes" : "no"} err=${errMsg}`,
      );
      return NextResponse.json(
        {
          message: "Session invalide.",
          code: bearerPresent ? "auth_bearer_rejected" : "auth_missing",
        },
        { status: 401 },
      );
    }

    const userId = user.id as string;
    const { data: cart } = await admin
      .from("carts")
      .select("id")
      .eq("id", cartId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!cart) {
      return NextResponse.json({ message: "Commande introuvable." }, { status: 404 });
    }

    const { url, amountCents } = await createBorrowOverdueCheckoutSession(admin, {
      userId,
      cartId,
      userEmail: user.email,
    });

    return NextResponse.json({ url, amountCents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de lancer le paiement.";
    if (message === "nothing_to_settle") {
      return NextResponse.json({ message: "Aucun frais de retard à régler.", code: message }, { status: 400 });
    }
    if (message === "amount_below_stripe_minimum") {
      return NextResponse.json(
        {
          message: "Le cumul des frais est inférieur au minimum Stripe (0,50 €). Ajoute d'abord une carte.",
          code: message,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ message }, { status: 500 });
  }
}
