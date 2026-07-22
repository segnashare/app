import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { itemChatJson, itemChatOptions } from "@/lib/item-chat/cors";
import {
  appendVisitorMessage,
  getConversationForVisitor,
  listMessages,
  normalizeEmail,
  normalizeMessageBody,
  toConversationDto,
} from "@/lib/item-chat/service";
import type { ItemChatSource } from "@/lib/item-chat/types";
import { UUID_RE } from "@/lib/item-chat/types";
import { readVisitorIdFromRequest } from "@/lib/item-chat/visitor";

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return itemChatOptions(request);
}

export async function GET(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return itemChatJson(request, { error: "id invalide" }, { status: 400 });
  }
  const visitorId = readVisitorIdFromRequest(request);
  if (!visitorId) {
    return itemChatJson(request, { error: "visitorId requis" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  try {
    const { syncItemChatDiscordInboundForConversation } = await import(
      "@/lib/item-chat/sync-discord"
    );
    await syncItemChatDiscordInboundForConversation(admin, conversation);
  } catch (e) {
    console.error("[item-chat] discord sync on GET failed", e);
  }

  const messages = await listMessages(admin, conversation.id);
  const dto = await toConversationDto(admin, conversation);
  return itemChatJson(request, { conversation: dto, messages });
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return itemChatJson(request, { error: "id invalide" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return itemChatJson(request, { error: "JSON invalide" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const visitorId = readVisitorIdFromRequest(request, b.visitorId);
  const messageBody = normalizeMessageBody(b.body);
  const sourceRaw = typeof b.source === "string" ? b.source.trim() : "app";
  const source: ItemChatSource = sourceRaw === "web" ? "web" : "app";

  if (!visitorId || !messageBody) {
    return itemChatJson(request, { error: "Message invalide" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createSupabaseAdminClient();
  let conversation = await getConversationForVisitor({
    admin,
    conversationId: id,
    visitorId,
    userId: user?.id ?? null,
  });
  if (!conversation) {
    return itemChatJson(request, { error: "Conversation introuvable" }, { status: 404 });
  }

  if (!user && !conversation.contact_email) {
    const email = normalizeEmail(b.contactEmail);
    if (email) {
      const { data } = await admin
        .from("item_chat_conversations" as never)
        .update({ contact_email: email, updated_at: new Date().toISOString() } as never)
        .eq("id", conversation.id)
        .select("*")
        .single();
      if (data) conversation = data as typeof conversation;
    }
  }

  try {
    const result = await appendVisitorMessage({
      admin,
      conversation,
      body: messageBody,
      source,
    });
    const dto = await toConversationDto(admin, result.conversation);
    return itemChatJson(request, {
      message: result.message,
      ackMessage: result.ackMessage ?? null,
      conversation: dto,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return itemChatJson(request, { error: msg }, { status: 500 });
  }
}
