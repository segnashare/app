import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { itemChatJson, itemChatOptions } from "@/lib/item-chat/cors";
import {
  listConversationsForIdentity,
  normalizeEmail,
  openOrCreateConversation,
  toConversationDto,
} from "@/lib/item-chat/service";
import type { ItemChatSource } from "@/lib/item-chat/types";
import { UUID_RE } from "@/lib/item-chat/types";
import { readVisitorIdFromRequest } from "@/lib/item-chat/visitor";
import { resolveRequestUser } from "@/lib/supabase/request-user";

export async function OPTIONS(request: Request) {
  return itemChatOptions(request);
}

/** Liste les conversations du visiteur / membre. */
export async function GET(request: Request) {
  const visitorId = readVisitorIdFromRequest(request);
  if (!visitorId) {
    return itemChatJson(request, { error: "visitorId requis" }, { status: 400 });
  }

  const { user } = await resolveRequestUser(request);

  const admin = createSupabaseAdminClient();
  const conversations = await listConversationsForIdentity({
    admin,
    visitorId,
    userId: user?.id ?? null,
  });
  return itemChatJson(request, { conversations });
}

/** Ouvre ou reprend une conversation (pièce optionnelle = question générale). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return itemChatJson(request, { error: "JSON invalide" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const visitorId = readVisitorIdFromRequest(request, b.visitorId);
  const itemIdRaw = typeof b.itemId === "string" ? b.itemId.trim() : "";
  const itemId = itemIdRaw && UUID_RE.test(itemIdRaw) ? itemIdRaw : null;
  const sourceRaw = typeof b.source === "string" ? b.source.trim() : "";
  const source: ItemChatSource | null = sourceRaw === "web" || sourceRaw === "app" ? sourceRaw : null;

  if (!visitorId || !source) {
    return itemChatJson(request, { error: "Paramètres invalides" }, { status: 400 });
  }
  if (itemIdRaw && !itemId) {
    return itemChatJson(request, { error: "Paramètres invalides" }, { status: 400 });
  }

  const contactEmail = normalizeEmail(b.contactEmail);
  let itemTitle = typeof b.itemTitle === "string" ? b.itemTitle.trim().slice(0, 200) || null : null;
  const itemSizeLabel =
    typeof b.itemSizeLabel === "string" ? b.itemSizeLabel.trim().slice(0, 80) || null : null;
  const itemConditionLabel =
    typeof b.itemConditionLabel === "string"
      ? b.itemConditionLabel.trim().slice(0, 80) || null
      : null;

  const { user } = await resolveRequestUser(request);

  const email = contactEmail || (typeof user?.email === "string" ? user.email.trim().toLowerCase() : null);

  const admin = createSupabaseAdminClient();

  if (itemId) {
    const { data: item } = await admin
      .from("items")
      .select("id, title")
      .eq("id", itemId)
      .maybeSingle();
    if (!item) {
      return itemChatJson(request, { error: "Pièce introuvable" }, { status: 404 });
    }
    if (!itemTitle && typeof item.title === "string") itemTitle = item.title;
  }

  try {
    const conversation = await openOrCreateConversation({
      admin,
      itemId,
      visitorId,
      source,
      contactEmail: email,
      userId: user?.id ?? null,
      itemTitle,
      itemSizeLabel,
      itemConditionLabel,
      forceNew: b.forceNew === true && !itemId,
    });
    const dto = await toConversationDto(admin, conversation);
    return itemChatJson(request, { conversation: dto });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return itemChatJson(request, { error: msg }, { status: 500 });
  }
}
