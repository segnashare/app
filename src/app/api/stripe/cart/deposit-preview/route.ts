import { NextResponse } from "next/server";

import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import { resolveRentalDepositPreview } from "@/lib/stripe/rental-deposit-hold";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

export async function GET(request: Request) {
  try {
    const { user, error: userError } = await resolveRequestUserClient(request);
    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const url = new URL(request.url);
    const purchaseMode =
      url.searchParams.get("purchaseMode") === "1" || url.searchParams.get("purchaseMode") === "true";

    const admin = createSupabaseAdminClient();
    const { data: activeCart } = await admin
      .from("carts")
      .select("id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .in("status", [...CART_STATUSES_OPEN])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const preview = await resolveRentalDepositPreview(admin, {
      userId: user.id,
      currentCartId: (activeCart as { id?: string } | null)?.id ?? null,
      purchaseMode,
    });

    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de calculer la caution.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
