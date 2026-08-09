import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ITEM_CHAT_MAX_PHOTO_BYTES,
  ITEM_CHAT_MAX_PHOTOS,
  uploadItemChatImageBuffer,
} from "@/lib/item-chat/chat-image-storage";
import { itemChatJson, itemChatOptions } from "@/lib/item-chat/cors";
import { getConversationForVisitor } from "@/lib/item-chat/service";
import { UUID_RE } from "@/lib/item-chat/types";
import { readVisitorIdFromRequest } from "@/lib/item-chat/visitor";
import { resolveRequestUser } from "@/lib/supabase/request-user";

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return itemChatOptions(request);
}

function guessImageTypeFromName(name: string): string | null {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

/** File (web) ou Blob RN multipart — MIME parfois vide. */
function asImageUploadPart(
  entry: FormDataEntryValue,
): { bytesPromise: Promise<ArrayBuffer>; contentType: string; filenameHint: string } | null {
  if (typeof entry === "string") return null;
  const blob = entry as Blob;
  const filenameHint =
    "name" in entry && typeof (entry as File).name === "string" && (entry as File).name.trim()
      ? (entry as File).name.trim()
      : "photo.jpg";
  const declared = (blob.type || "").trim().toLowerCase();
  const contentType =
    declared.startsWith("image/")
      ? declared
      : guessImageTypeFromName(filenameHint) || "image/jpeg";
  if (!contentType.startsWith("image/")) return null;
  const size = typeof blob.size === "number" ? blob.size : 0;
  if (size <= 0 || size > ITEM_CHAT_MAX_PHOTO_BYTES) return null;
  return {
    bytesPromise: blob.arrayBuffer(),
    contentType,
    filenameHint,
  };
}

/**
 * Upload 1–N images pour le chat (épingle).
 * Retourne des URLs signées à coller dans le body du message (une URL par ligne).
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return itemChatJson(request, { error: "id invalide" }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return itemChatJson(request, { error: "multipart/form-data requis" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return itemChatJson(request, { error: "Formulaire invalide" }, { status: 400 });
  }

  const visitorId = readVisitorIdFromRequest(request, form.get("visitorId"));
  if (!visitorId) {
    return itemChatJson(request, { error: "visitorId requis" }, { status: 400 });
  }

  const { user } = await resolveRequestUser(request);
  const admin = createSupabaseAdminClient();
  const conversation = await getConversationForVisitor({
    admin,
    conversationId: id,
    visitorId,
    userId: user?.id ?? null,
  });
  if (!conversation) {
    return itemChatJson(request, { error: "Conversation introuvable" }, { status: 404 });
  }

  const parts = form
    .getAll("photos")
    .map(asImageUploadPart)
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .slice(0, ITEM_CHAT_MAX_PHOTOS);

  if (!parts.length) {
    return itemChatJson(request, { error: "Aucune photo" }, { status: 400 });
  }

  const urls: string[] = [];
  for (const part of parts) {
    const bytes = await part.bytesPromise;
    if (!bytes.byteLength || bytes.byteLength > ITEM_CHAT_MAX_PHOTO_BYTES) continue;
    const url = await uploadItemChatImageBuffer(admin, conversation.id, {
      bytes,
      contentType: part.contentType,
      filenameHint: part.filenameHint,
    });
    if (url) urls.push(url);
  }

  if (!urls.length) {
    return itemChatJson(request, { error: "Upload impossible" }, { status: 400 });
  }

  return itemChatJson(request, { urls });
}
