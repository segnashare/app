import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { itemChatJson, itemChatOptions } from "@/lib/item-chat/cors";
import { claimVisitorConversations } from "@/lib/item-chat/service";
import { readVisitorIdFromRequest } from "@/lib/item-chat/visitor";
import { resolveRequestUser } from "@/lib/supabase/request-user";

export async function OPTIONS(request: Request) {
  return itemChatOptions(request);
}

/** Rattache les conversations anonymes du visitorId au membre connecté. */
export async function POST(request: Request) {
  const { user } = await resolveRequestUser(request);
  if (!user) {
    return itemChatJson(request, { error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const visitorId = readVisitorIdFromRequest(request, (body as { visitorId?: unknown }).visitorId);
  if (!visitorId) {
    return itemChatJson(request, { error: "visitorId requis" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const claimed = await claimVisitorConversations({
    admin,
    visitorId,
    userId: user.id,
    email: typeof user.email === "string" ? user.email.trim().toLowerCase() : null,
  });
  return itemChatJson(request, { ok: true, claimed });
}
