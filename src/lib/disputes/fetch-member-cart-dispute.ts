import type { SupabaseClient } from "@supabase/supabase-js";

import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MemberCartDisputeDetail = {
  id: string;
  status: string;
  reason: string | null;
  category: string | null;
  scope: string | null;
  details: string;
  photoPaths: string[];
  photoUrls: string[];
  createdAtIso: string;
  updatedAtIso: string | null;
  reportKind: "borrow" | "reception";
  /** Conversation chatbot liée (si ouverte avec le litige). */
  conversationId: string | null;
};

function parsePhotoPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function mapDisputeRow(data: {
  id: string;
  status?: string | null;
  reason?: string | null;
  category?: string | null;
  scope?: string | null;
  details?: string | null;
  photo_paths?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
  conversation_id?: string | null;
}): Omit<MemberCartDisputeDetail, "photoUrls"> {
  const reason = typeof data.reason === "string" ? data.reason : null;
  const category = typeof data.category === "string" ? data.category : null;
  const reportKind: "borrow" | "reception" =
    reason === "member_reception_report" || (category ?? "").startsWith("reception_")
      ? "reception"
      : "borrow";
  const conversationId =
    typeof data.conversation_id === "string" && data.conversation_id.trim()
      ? data.conversation_id.trim()
      : null;
  return {
    id: data.id,
    status: String(data.status ?? "open"),
    reason,
    category,
    scope: typeof data.scope === "string" ? data.scope : null,
    details: typeof data.details === "string" ? data.details.trim() : "",
    photoPaths: parsePhotoPaths(data.photo_paths),
    createdAtIso: String(data.created_at ?? new Date().toISOString()),
    updatedAtIso: typeof data.updated_at === "string" ? data.updated_at : null,
    reportKind,
    conversationId,
  };
}

/**
 * Litige membre ouvert / en revue pour une commande (admin après ownership).
 */
export async function fetchMemberCartOpenDispute(
  admin: SupabaseClient,
  userId: string,
  cartId: string,
): Promise<MemberCartDisputeDetail | null> {
  const id = cartId.trim();
  if (!CART_ID_RE.test(id)) return null;

  const { data: cart, error: cartErr } = await admin
    .from("carts")
    .select("id,user_id")
    .eq("id", id)
    .maybeSingle();

  if (cartErr || !cart || cart.user_id !== userId) return null;

  let disputeRows: unknown[] | null = null;
  let disputeErr: { message?: string } | null = null;

  {
    const res = await admin
      .from("cart_disputes")
      .select(
        "id,status,reason,category,scope,details,photo_paths,created_at,updated_at,conversation_id",
      )
      .eq("cart_id", id)
      .is("deleted_at", null)
      .in("status", ["open", "in_review"])
      .order("created_at", { ascending: false })
      .limit(1);
    disputeErr = res.error;
    disputeRows = res.data;
  }

  // Colonne conversation_id absente tant que la migration n’est pas appliquée.
  if (disputeErr?.message?.includes("conversation_id")) {
    const res = await admin
      .from("cart_disputes")
      .select("id,status,reason,category,scope,details,photo_paths,created_at,updated_at")
      .eq("cart_id", id)
      .is("deleted_at", null)
      .in("status", ["open", "in_review"])
      .order("created_at", { ascending: false })
      .limit(1);
    disputeErr = res.error;
    disputeRows = res.data;
  }

  const first = Array.isArray(disputeRows) ? disputeRows[0] : null;
  if (disputeErr || !first || typeof (first as { id?: unknown }).id !== "string") return null;

  const base = mapDisputeRow(first as Parameters<typeof mapDisputeRow>[0]);
  let conversationId = base.conversationId;
  if (!conversationId) {
    const { data: chatRow } = await admin
      .from("item_chat_conversations")
      .select("id")
      .eq("cart_dispute_id", base.id)
      .maybeSingle();
    if (typeof chatRow?.id === "string" && chatRow.id.trim()) {
      conversationId = chatRow.id.trim();
    }
  }

  const signed =
    base.photoPaths.length > 0
      ? await createSignedUrlsForStoragePaths(admin, base.photoPaths, 60 * 60 * 24, {
          explicitBucket: "bucket_items",
        })
      : new Map<string, string>();

  return {
    ...base,
    conversationId,
    photoUrls: base.photoPaths
      .map((p) => signed.get(p) ?? null)
      .filter((u): u is string => Boolean(u)),
  };
}

/** Carts du membre avec litige open / in_review. */
export async function fetchMemberOpenDisputeCartIds(
  admin: SupabaseClient,
  userId: string,
  cartIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(cartIds.map((c) => c.trim()).filter((v) => CART_ID_RE.test(v)))].slice(0, 80);
  if (ids.length === 0) return new Set();

  const { data: owned, error: ownedErr } = await admin
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .in("id", ids)
    .is("deleted_at", null);

  if (ownedErr) return new Set();
  const ownedIds = (owned ?? []).map((r: { id: string }) => r.id);
  if (ownedIds.length === 0) return new Set();

  const { data, error } = await admin
    .from("cart_disputes")
    .select("cart_id")
    .in("cart_id", ownedIds)
    .is("deleted_at", null)
    .in("status", ["open", "in_review"]);

  if (error || !data) return new Set();
  return new Set(
    data
      .map((r: { cart_id?: string | null }) => (typeof r.cart_id === "string" ? r.cart_id : ""))
      .filter(Boolean),
  );
}
