import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { itemChatJson, itemChatOptions } from "@/lib/item-chat/cors";
import {
  getConversationForVisitor,
  setConversationVisitorArchived,
  toConversationDto,
} from "@/lib/item-chat/service";
import { UUID_RE } from "@/lib/item-chat/types";
import { readVisitorIdFromRequest } from "@/lib/item-chat/visitor";
import { resolveRequestUser } from "@/lib/supabase/request-user";

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return itemChatOptions(request);
}

/**
 * Archive / désarchive une conversation côté membre (feed inbox).
 * POST { archived?: boolean } — défaut `true`.
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return itemChatJson(request, { error: "id invalide" }, { status: 400 });
  }
  const visitorId = readVisitorIdFromRequest(request);
  if (!visitorId) {
    return itemChatJson(request, { error: "visitorId requis" }, { status: 400 });
  }

  let archived = true;
  try {
    const body = (await request.json()) as { archived?: unknown };
    if (typeof body.archived === "boolean") archived = body.archived;
  } catch {
    // body optionnel → archive
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

  const updated = await setConversationVisitorArchived({
    admin,
    conversation,
    archived,
  });
  if (!updated) {
    return itemChatJson(request, { error: "Mise à jour impossible" }, { status: 500 });
  }

  const dto = await toConversationDto(admin, updated);
  return itemChatJson(request, { ok: true, conversation: dto });
}
