import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isMemberCartDisputeCategoryId,
  isMemberCartDisputeScope,
  memberCartDisputeReasonForKind,
  type MemberCartDisputeReportKind,
  type MemberCartDisputeScope,
} from "@/lib/disputes/member-cart-dispute-categories";
import { ensureDisputeItemChat } from "@/lib/disputes/ensure-dispute-item-chat";
import { notifyCartDisputeN8n } from "@/lib/disputes/notify-cart-dispute-n8n";
import type { ItemChatSource } from "@/lib/item-chat/types";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";

const DISPUTE_PHOTO_BUCKET = "bucket_items";
const MAX_DETAILS_LEN = 4000;
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export type OpenMemberCartDisputeInput = {
  cartId: string;
  userId: string;
  userEmail: string | null;
  reportKind: MemberCartDisputeReportKind;
  category: string;
  scope: MemberCartDisputeScope;
  details: string;
  itemIds: string[];
  photoFiles: File[];
  chatSource?: ItemChatSource;
};

export type OpenMemberCartDisputeResult =
  | { ok: true; disputeId: string; updated: boolean; conversationId: string | null }
  | { ok: false; status: number; error: string };

async function uploadDisputePhotos(
  admin: SupabaseClient,
  cartId: string,
  disputeId: string,
  files: File[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files.slice(0, MAX_PHOTOS)) {
    if (!file.type.startsWith("image/") || file.size <= 0 || file.size > MAX_PHOTO_BYTES) continue;
    const ext =
      file.name.includes(".")
        ? (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"
        : "jpg";
    const path = `cart_disputes/${cartId}/${disputeId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage.from(DISPUTE_PHOTO_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
    if (!error) paths.push(path);
  }
  return paths;
}

async function syncItemDisputes(
  admin: SupabaseClient,
  cartDisputeId: string,
  itemIds: string[],
  reasonPrefix: string,
  category: string,
  details: string,
): Promise<void> {
  if (itemIds.length === 0) return;

  const rows = itemIds.map((itemId) => ({
    cart_dispute_id: cartDisputeId,
    item_id: itemId,
    reason: `${reasonPrefix}:${category}`,
    details,
    status: "open",
  }));

  const { error } = await admin.from("item_disputes").insert(rows);
  if (error) {
    console.error("[open-member-cart-dispute] item_disputes insert", error.message);
  }
}

export async function openMemberCartDispute(
  memberClient: SupabaseClient,
  admin: SupabaseClient,
  input: OpenMemberCartDisputeInput,
): Promise<OpenMemberCartDisputeResult> {
  const details = input.details.trim();
  const reason = memberCartDisputeReasonForKind(input.reportKind);

  if (!isMemberCartDisputeCategoryId(input.category, input.reportKind)) {
    return { ok: false, status: 400, error: "Choisis un type de problème." };
  }
  if (!isMemberCartDisputeScope(input.scope)) {
    return { ok: false, status: 400, error: "Périmètre invalide." };
  }
  if (!details) {
    return { ok: false, status: 400, error: "Décris le problème rencontré." };
  }
  if (details.length > MAX_DETAILS_LEN) {
    return { ok: false, status: 400, error: "Description trop longue." };
  }
  if (input.scope === "selected_items" && input.itemIds.length === 0) {
    return { ok: false, status: 400, error: "Sélectionne au moins un article." };
  }

  const { data: cart, error: cartErr } = await memberClient
    .from("carts")
    .select("id,user_id,status")
    .eq("id", input.cartId)
    .maybeSingle();

  if (cartErr) {
    console.error("[open-member-cart-dispute] carts", cartErr.message);
    return { ok: false, status: 500, error: "Lecture commande impossible." };
  }
  if (!cart || cart.user_id !== input.userId) {
    return { ok: false, status: 404, error: "Commande introuvable." };
  }

  if (input.scope === "selected_items" && input.itemIds.length > 0) {
    const { data: lines, error: linesErr } = await memberClient
      .from("cart_items")
      .select("item_id")
      .eq("cart_id", input.cartId)
      .in("item_id", input.itemIds);

    if (linesErr) {
      return { ok: false, status: 500, error: "Vérification des articles impossible." };
    }
    const allowed = new Set((lines ?? []).map((r: { item_id: string }) => r.item_id));
    if (input.itemIds.some((id) => !allowed.has(id))) {
      return { ok: false, status: 400, error: "Un ou plusieurs articles ne font pas partie de cette commande." };
    }
  }

  const nowIso = new Date().toISOString();

  let existingQuery = await admin
    .from("cart_disputes")
    .select("id,status,photo_paths,conversation_id")
    .eq("cart_id", input.cartId)
    .eq("reason", reason)
    .is("deleted_at", null)
    .in("status", ["open", "in_review"])
    .maybeSingle();

  // Colonne conversation_id absente tant que la migration n’est pas appliquée.
  if (existingQuery.error?.message?.includes("conversation_id")) {
    existingQuery = await admin
      .from("cart_disputes")
      .select("id,status,photo_paths")
      .eq("cart_id", input.cartId)
      .eq("reason", reason)
      .is("deleted_at", null)
      .in("status", ["open", "in_review"])
      .maybeSingle();
  }

  if (existingQuery.error) {
    console.error("[open-member-cart-dispute] select dispute", existingQuery.error.message);
    return { ok: false, status: 500, error: "Enregistrement impossible. Réessaie." };
  }

  const existing = existingQuery.data;

  let disputeId: string;
  let updated: boolean;
  let photoPaths: string[] = [];
  let existingConversationId: string | null =
    existing && typeof (existing as { conversation_id?: unknown }).conversation_id === "string"
      ? ((existing as { conversation_id: string }).conversation_id)
      : null;

  if (existing?.id) {
    disputeId = existing.id as string;
    updated = true;
    const prevPaths = Array.isArray(existing.photo_paths)
      ? (existing.photo_paths as string[])
      : [];
    const newPaths = await uploadDisputePhotos(admin, input.cartId, disputeId, input.photoFiles);
    photoPaths = [...prevPaths, ...newPaths].slice(0, MAX_PHOTOS);

    const { error: updateErr } = await admin
      .from("cart_disputes")
      .update({
        category: input.category,
        scope: input.scope,
        details,
        photo_paths: photoPaths,
        updated_at: nowIso,
      })
      .eq("id", disputeId);

    if (updateErr) {
      console.error("[open-member-cart-dispute] update", updateErr.message);
      return { ok: false, status: 500, error: "Enregistrement impossible. Réessaie." };
    }
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from("cart_disputes")
      .insert({
        cart_id: input.cartId,
        opened_by_user_id: input.userId,
        reason,
        category: input.category,
        scope: input.scope,
        details,
        photo_paths: [],
        status: "open",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[open-member-cart-dispute] insert", insertErr.message);
      return { ok: false, status: 500, error: "Enregistrement impossible. Réessaie." };
    }
    disputeId = inserted.id as string;
    updated = false;
    photoPaths = await uploadDisputePhotos(admin, input.cartId, disputeId, input.photoFiles);

    if (photoPaths.length > 0) {
      await admin.from("cart_disputes").update({ photo_paths: photoPaths, updated_at: nowIso }).eq("id", disputeId);
    }

    if (input.reportKind === "borrow") {
      await admin.from("carts").update({ status: "disputed", updated_at: nowIso }).eq("id", input.cartId);
    }
  }

  if (input.scope === "selected_items") {
    await syncItemDisputes(admin, disputeId, input.itemIds, reason, input.category, details);
  }

  // Signing best-effort : ne doit jamais empêcher l’ouverture du fil chatbot.
  let photoUrls: string[] = [];
  if (photoPaths.length > 0) {
    try {
      const signedPhotoMap = await createSignedUrlsForStoragePaths(
        admin,
        photoPaths,
        60 * 60 * 24 * 7,
        { explicitBucket: DISPUTE_PHOTO_BUCKET },
      );
      photoUrls = photoPaths
        .map((p) => signedPhotoMap.get(p) ?? null)
        .filter((u): u is string => Boolean(u));
    } catch (err) {
      console.warn(
        "[open-member-cart-dispute] photo signed urls",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const conversationId = await ensureDisputeItemChat({
    admin,
    cartId: input.cartId,
    disputeId,
    existingConversationId,
    userId: input.userId,
    userEmail: input.userEmail,
    reportKind: input.reportKind,
    category: input.category,
    details,
    photoUrls,
    updated,
    source: input.chatSource ?? "app",
  });

  const n8n = await notifyCartDisputeN8n({
    cartId: input.cartId,
    disputeId,
    userId: input.userId,
    userEmail: input.userEmail,
    details,
    category: input.category,
    scope: input.scope,
    reportKind: input.reportKind,
    reason,
    itemIds: input.scope === "selected_items" ? input.itemIds : [],
    photoPaths,
    photoUrls,
    cartStatus: typeof cart.status === "string" ? cart.status : null,
    updated,
  });

  if (!n8n.ok) {
    if (n8n.reason === "missing_url") {
      return {
        ok: false,
        status: 503,
        error: "Le signalement est enregistré mais l’acheminement vers l’équipe n’est pas configuré.",
      };
    }
    return {
      ok: false,
      status: 502,
      error: "Signalement enregistré, mais la notification à l’équipe a échoué. Réessaie dans un instant.",
    };
  }

  return { ok: true, disputeId, updated, conversationId };
}
