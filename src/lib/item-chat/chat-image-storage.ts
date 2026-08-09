import type { SupabaseClient } from "@supabase/supabase-js";

import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";

export const ITEM_CHAT_PHOTO_BUCKET = "bucket_items";
export const ITEM_CHAT_MAX_PHOTOS = 6;
export const ITEM_CHAT_MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function extFromContentType(contentType: string, fallback = "jpg"): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return fallback;
}

/** Upload un buffer image dans Storage et retourne une URL signée (7 j). */
export async function uploadItemChatImageBuffer(
  admin: SupabaseClient,
  conversationId: string,
  input: {
    bytes: ArrayBuffer | Uint8Array;
    contentType: string;
    filenameHint?: string;
  },
): Promise<string | null> {
  const hint = (input.filenameHint || "").toLowerCase();
  const fromName = hint.includes(".")
    ? (hint.split(".").pop() || "").replace(/[^a-z0-9]/g, "")
    : "";
  const ext = fromName || extFromContentType(input.contentType || "image/jpeg");
  const path = `item_chat/${conversationId}/${crypto.randomUUID()}.${ext}`;
  const body =
    input.bytes instanceof ArrayBuffer
      ? new Uint8Array(input.bytes)
      : input.bytes;
  const { error } = await admin.storage.from(ITEM_CHAT_PHOTO_BUCKET).upload(path, body, {
    upsert: false,
    contentType: input.contentType || `image/${ext === "jpg" ? "jpeg" : ext}`,
  });
  if (error) {
    console.error("[item-chat] image upload failed", error.message);
    return null;
  }
  const signed = await createSignedUrlsForStoragePaths(admin, [path], 60 * 60 * 24 * 7, {
    explicitBucket: ITEM_CHAT_PHOTO_BUCKET,
  });
  return signed.get(path) ?? null;
}

/** Télécharge une image distante (ex. CDN Discord) et la rehéberge. */
export async function rehostRemoteChatImage(
  admin: SupabaseClient,
  conversationId: string,
  sourceUrl: string,
  filenameHint?: string,
): Promise<string | null> {
  const url = sourceUrl.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength <= 0 || bytes.byteLength > ITEM_CHAT_MAX_PHOTO_BYTES) return null;
    return uploadItemChatImageBuffer(admin, conversationId, {
      bytes,
      contentType,
      filenameHint,
    });
  } catch (e) {
    console.error("[item-chat] rehost failed", e);
    return null;
  }
}
