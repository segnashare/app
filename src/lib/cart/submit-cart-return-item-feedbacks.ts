import { isCartReturnEligibleForItemFeedback } from "@/lib/cart/cart-return-feedback-eligibility";
import {
  completedFeedbackCreditElements,
  grantReturnFeedbackCredits,
} from "@/lib/feedback/grant-return-feedback-credits";
import type { CartReturnFeedbackDraft } from "@/lib/feedback/item-feedback-types";
import { uploadFeedbackWornPhotos } from "@/lib/feedback/upload-feedback-worn-photos";
import type { SupabaseClient } from "@supabase/supabase-js";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FeedbackQuery = {
  eq: (col: string, val: unknown) => FeedbackQuery;
  is: (col: string, val: unknown) => FeedbackQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
  order: (col: string, opts: { ascending: boolean }) => {
    limit: (n: number) => { maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }> };
  };
  in: (col: string, vals: unknown[]) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

type AdminSupabase = SupabaseClient & {
  storage: SupabaseClient["storage"];
};

export type SubmitCartReturnFeedbacksResult =
  | { ok: true; savedCount: number; creditsGranted: number }
  | { ok: false; error: string; status: number };

export function parseCartReturnFeedbackDrafts(raw: unknown): CartReturnFeedbackDraft[] | null {
  if (!Array.isArray(raw)) return null;
  const drafts: CartReturnFeedbackDraft[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const o = entry as Record<string, unknown>;
    const cartItemId = typeof o.cart_item_id === "string" ? o.cart_item_id.trim() : "";
    const itemId = typeof o.item_id === "string" ? o.item_id.trim() : "";
    const rating = Number(o.rating);
    const comment = typeof o.comment === "string" ? o.comment.trim() : "";
    const keepPaths = Array.isArray(o.keep_worn_photo_paths)
      ? o.keep_worn_photo_paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    if (!cartItemId || !itemId) return null;
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;
    drafts.push({
      cartItemId,
      itemId,
      rating: Math.round(rating),
      comment,
      keepWornPhotoPaths: keepPaths,
      wornPhotoFiles: [],
    });
  }
  return drafts;
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export async function submitCartReturnItemFeedbacks(
  admin: AdminSupabase,
  userId: string,
  cartId: string,
  drafts: CartReturnFeedbackDraft[],
): Promise<SubmitCartReturnFeedbacksResult> {
  if (!CART_ID_RE.test(cartId)) {
    return { ok: false, error: "Identifiant de commande invalide.", status: 400 };
  }
  if (drafts.length === 0) {
    return { ok: false, error: "Aucune note à enregistrer.", status: 400 };
  }

  const { data: cart, error: cartErr } = await admin
    .from("carts")
    .select("id,user_id,status")
    .eq("id", cartId)
    .is("deleted_at", null)
    .maybeSingle();

  if (cartErr || !cart) {
    return { ok: false, error: "Commande introuvable.", status: 404 };
  }
  const cartRow = cart as { user_id?: string; status?: string };
  if (cartRow.user_id !== userId) {
    return { ok: false, error: "Accès refusé.", status: 403 };
  }
  if (String(cartRow.status ?? "").toLowerCase() !== "confirmed") {
    return { ok: false, error: "Commande non éligible.", status: 400 };
  }

  const { data: retShip } = await admin
    .from("shipments")
    .select("status")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const returnStatus = String((retShip as { status?: string } | null)?.status ?? "");
  if (!isCartReturnEligibleForItemFeedback(returnStatus)) {
    return {
      ok: false,
      error: "Les avis sont disponibles une fois le retour initié (dépôt au relais).",
      status: 400,
    };
  }

  const cartItemIds = [...new Set(drafts.map((d) => d.cartItemId))];
  const { data: cartItems, error: itemsErr } = await admin
    .from("cart_items")
    .select("id,item_id,cart_id")
    .eq("cart_id", cartId)
    .is("deleted_at", null)
    .in("id", cartItemIds);

  if (itemsErr || !Array.isArray(cartItems)) {
    return { ok: false, error: "Impossible de valider les articles.", status: 500 };
  }

  const validById = new Map<string, string>();
  for (const row of cartItems as Array<Record<string, unknown>>) {
    const id = String(row.id ?? "");
    const itemId = String(row.item_id ?? "");
    if (id && itemId) validById.set(id, itemId);
  }

  let savedCount = 0;
  let creditsGranted = 0;
  const nowIso = new Date().toISOString();

  for (const draft of drafts) {
    const expectedItemId = validById.get(draft.cartItemId);
    if (!expectedItemId || expectedItemId !== draft.itemId) {
      return { ok: false, error: "Article du panier invalide.", status: 400 };
    }

    const { data: existingRow } = await admin
      .from("feedbacks")
      .select("id,metadata")
      .eq("cart_item_id", draft.cartItemId)
      .eq("reviewer_user_id", userId)
      .eq("target_type", "item")
      .is("deleted_at", null)
      .maybeSingle();

    const existingMeta = parseMetadata((existingRow as { metadata?: unknown } | null)?.metadata);
    const existingPaths = Array.isArray(existingMeta.worn_photo_paths)
      ? existingMeta.worn_photo_paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];

    const uploadedPaths = await uploadFeedbackWornPhotos(
      admin,
      userId,
      cartId,
      draft.cartItemId,
      draft.wornPhotoFiles ?? [],
    );
    const keepSet = new Set(draft.keepWornPhotoPaths ?? []);
    const mergedPaths = [
      ...existingPaths.filter((p) => keepSet.has(p)),
      ...uploadedPaths.filter((p) => !existingPaths.includes(p)),
    ].slice(0, 3);

    const metadata = {
      ...existingMeta,
      worn_photo_paths: mergedPaths,
    };

    const payload = {
      rating: draft.rating,
      comment: draft.comment || null,
      metadata,
      updated_at: nowIso,
    };

    if (existingRow && typeof (existingRow as { id?: string }).id === "string") {
      const { error: updateErr } = await admin
        .from("feedbacks")
        .update(payload)
        .eq("id", (existingRow as { id: string }).id);
      if (updateErr) {
        return { ok: false, error: updateErr.message ?? "Mise à jour impossible.", status: 500 };
      }
    } else {
      const { error: insertErr } = await admin.from("feedbacks").insert({
        target_type: "item",
        cart_id: cartId,
        cart_item_id: draft.cartItemId,
        item_id: draft.itemId,
        reviewer_user_id: userId,
        rating: draft.rating,
        comment: draft.comment || null,
        metadata,
      });
      if (insertErr) {
        return { ok: false, error: insertErr.message ?? "Enregistrement impossible.", status: 500 };
      }
    }

    const creditElements = completedFeedbackCreditElements({
      rating: draft.rating,
      comment: draft.comment,
      wornPhotoCount: mergedPaths.length,
    });
    const grant = await grantReturnFeedbackCredits(
      admin,
      userId,
      cartId,
      draft.cartItemId,
      draft.itemId,
      creditElements,
    );
    creditsGranted += grant.totalGranted;
    savedCount += 1;
  }

  return { ok: true, savedCount, creditsGranted };
}
