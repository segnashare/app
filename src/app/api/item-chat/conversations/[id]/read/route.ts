import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { itemChatJson, itemChatOptions } from "@/lib/item-chat/cors";
import {
  getConversationForVisitor,
  markConversationRead,
  toConversationDto,
} from "@/lib/item-chat/service";
import { UUID_RE } from "@/lib/item-chat/types";
import { readVisitorIdFromRequest } from "@/lib/item-chat/visitor";

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return itemChatOptions(request);
}

/** Marque la conversation comme lue (reset badge). */
export async function POST(request: Request, ctx: RouteContext) {
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

  await markConversationRead({ admin, conversationId: conversation.id });
  const { data } = await admin
    .from("item_chat_conversations" as never)
    .select("*")
    .eq("id", conversation.id)
    .single();
  const dto = data
    ? await toConversationDto(admin, data as typeof conversation)
    : await toConversationDto(admin, { ...conversation, last_read_at: new Date().toISOString() });
  return itemChatJson(request, { conversation: dto });
}
