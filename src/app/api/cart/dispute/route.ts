import { NextResponse } from "next/server";

import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestUserClient } from "@/lib/supabase/request-user";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePhotoPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

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

  const { data: cart, error: cartErr } = await admin
    .from("carts")
    .select("id,user_id")
    .eq("id", cartId)
    .maybeSingle();

  if (cartErr) {
    return NextResponse.json({ error: "Lecture commande impossible." }, { status: 500 });
  }
  if (!cart || cart.user_id !== userId) {
    return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  }

  const { data: rows, error: disputeErr } = await admin
    .from("cart_disputes")
    .select("id,status,reason,category,scope,details,photo_paths,created_at,updated_at")
    .eq("cart_id", cartId)
    .is("deleted_at", null)
    .in("status", ["open", "in_review"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (disputeErr) {
    return NextResponse.json({ error: "Lecture litige impossible." }, { status: 500 });
  }

  const data = rows?.[0];
  if (!data?.id) {
    return NextResponse.json({ dispute: null });
  }

  const photoPaths = parsePhotoPaths(data.photo_paths);
  const signed =
    photoPaths.length > 0
      ? await createSignedUrlsForStoragePaths(admin, photoPaths, 60 * 60 * 24, {
          explicitBucket: "bucket_items",
        })
      : new Map<string, string>();
  const photoUrls = photoPaths
    .map((p) => signed.get(p) ?? null)
    .filter((u): u is string => Boolean(u));

  const reason = typeof data.reason === "string" ? data.reason : null;
  const category = typeof data.category === "string" ? data.category : null;
  const reportKind =
    reason === "member_reception_report" || (category ?? "").startsWith("reception_")
      ? "reception"
      : "borrow";

  return NextResponse.json({
    dispute: {
      id: data.id as string,
      status: String(data.status ?? "open"),
      reason,
      category,
      scope: typeof data.scope === "string" ? data.scope : null,
      details: typeof data.details === "string" ? data.details.trim() : "",
      photoPaths,
      photoUrls,
      createdAtIso: String(data.created_at ?? new Date().toISOString()),
      updatedAtIso: typeof data.updated_at === "string" ? data.updated_at : null,
      reportKind,
    },
  });
}
