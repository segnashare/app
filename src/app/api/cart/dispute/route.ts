import { NextResponse } from "next/server";

import { fetchMemberCartOpenDispute } from "@/lib/disputes/fetch-member-cart-dispute";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Litige ouvert / en revue pour une commande du membre (lecture admin après ownership).
 * GET ?cartId=…
 * GET ?cartIds=id1,id2,… → { openCartIds: string[] }
 */
export async function GET(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { user, error: userError } = (await resolveRequestUserClient(request)) as any;
  if (userError || !user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const userId = user.id as string;
  const url = new URL(request.url);
  const cartId = (url.searchParams.get("cartId") ?? "").trim();
  const cartIdsRaw = (url.searchParams.get("cartIds") ?? "").trim();

  const admin = createSupabaseAdminClient();

  if (cartIdsRaw) {
    const cartIds = cartIdsRaw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => CART_ID_RE.test(v))
      .slice(0, 80);
    if (cartIds.length === 0) {
      return NextResponse.json({ openCartIds: [] as string[] });
    }

    const { data: owned, error: ownedErr } = await admin
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .in("id", cartIds)
      .is("deleted_at", null);

    if (ownedErr) {
      return NextResponse.json({ error: "Lecture commandes impossible." }, { status: 500 });
    }
    const ownedIds = (owned ?? []).map((r: { id: string }) => r.id);
    if (ownedIds.length === 0) {
      return NextResponse.json({ openCartIds: [] as string[] });
    }

    const { data: disputes, error: dErr } = await admin
      .from("cart_disputes")
      .select("cart_id")
      .in("cart_id", ownedIds)
      .is("deleted_at", null)
      .in("status", ["open", "in_review"]);

    if (dErr) {
      return NextResponse.json({ error: "Lecture litiges impossible." }, { status: 500 });
    }

    const openCartIds = [
      ...new Set(
        (disputes ?? [])
          .map((r: { cart_id?: string | null }) => (typeof r.cart_id === "string" ? r.cart_id : ""))
          .filter(Boolean),
      ),
    ];
    return NextResponse.json({ openCartIds });
  }

  if (!CART_ID_RE.test(cartId)) {
    return NextResponse.json({ error: "Identifiant de commande invalide" }, { status: 400 });
  }

  const dispute = await fetchMemberCartOpenDispute(admin, userId, cartId);
  return NextResponse.json({ dispute });
}
