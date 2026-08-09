import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncItemChatDiscordInboundByConversationId } from "@/lib/item-chat/sync-discord";
import { UUID_RE } from "@/lib/item-chat/types";

function itemChatInternalSecrets(): string[] {
  const primary = process.env.SEGNA_INTERNAL_ITEM_CHAT_SECRET?.trim() ?? "";
  const webhook = process.env.N8N_ITEM_CHAT_WEBHOOK_SECRET?.trim() ?? "";
  const lifecycle =
    process.env.SEGNA_INTERNAL_MEMBER_LIFECYCLE_SECRET?.trim() ||
    process.env.SEGNA_INTERNAL_CART_LAUNCH_UBER_SECRET?.trim() ||
    "";
  return [...new Set([primary, webhook, lifecycle].filter(Boolean))];
}

function readBearer(request: Request): string {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return (
    request.headers.get("x-segna-item-chat-secret")?.trim() ||
    request.headers.get("x-api-key")?.trim() ||
    ""
  );
}

/**
 * Force un sync Discord → DB pour une conversation (BO litige pièce / ops).
 * Auth : Bearer = secret item-chat ou lifecycle interne.
 * Body : `{ "conversation_id": "uuid" }`
 */
export async function POST(request: Request) {
  const candidates = itemChatInternalSecrets();
  if (candidates.length === 0) {
    return NextResponse.json(
      { ok: false as const, error: "internal_secret_not_configured" },
      { status: 503 },
    );
  }

  const token = readBearer(request);
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { conversation_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ ok: false as const, error: "invalid_conversation_id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  try {
    const inserted = await syncItemChatDiscordInboundByConversationId(admin, conversationId);
    return NextResponse.json({ ok: true as const, inserted });
  } catch (e) {
    console.error("[item-chat/sync-conversation]", e);
    return NextResponse.json(
      { ok: false as const, error: e instanceof Error ? e.message : "sync_failed" },
      { status: 500 },
    );
  }
}
