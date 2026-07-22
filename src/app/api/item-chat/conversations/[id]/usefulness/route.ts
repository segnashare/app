import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { itemChatJson, itemChatOptions } from "@/lib/item-chat/cors";
import {
  getConversationForVisitor,
  recordUsefulnessRating,
  toConversationDto,
} from "@/lib/item-chat/service";
import { UUID_RE } from "@/lib/item-chat/types";
import { readVisitorIdFromRequest } from "@/lib/item-chat/visitor";

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS(request: Request) {
  return itemChatOptions(request);
}

/** Réponse Oui / Non au prompt « discussion utile ? ». */
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
  const rating = b.rating === "yes" || b.rating === "no" ? b.rating : null;
  if (!visitorId || !rating) {
    return itemChatJson(request, { error: "Paramètres invalides" }, { status: 400 });
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

  const result = await recordUsefulnessRating({ admin, conversation, rating });
  if (!result) {
    return itemChatJson(
      request,
      { error: "Réponse déjà enregistrée ou indisponible" },
      { status: 409 },
    );
  }

  const dto = await toConversationDto(admin, result.conversation);
  return itemChatJson(request, {
    conversation: dto,
    messages: [result.answerMessage, result.thankYouMessage],
  });
}
