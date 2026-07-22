import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bindDiscordThread } from "@/lib/item-chat/service";
import { UUID_RE } from "@/lib/item-chat/types";

function itemChatInternalSecrets(): string[] {
  const primary = process.env.SEGNA_INTERNAL_ITEM_CHAT_SECRET?.trim() ?? "";
  const webhook = process.env.N8N_ITEM_CHAT_WEBHOOK_SECRET?.trim() ?? "";
  return [...new Set([primary, webhook].filter(Boolean))];
}

/**
 * n8n enregistre le fil Discord après création.
 * Body : `{ "conversation_id": "uuid", "discord_thread_id": "…" }`
 */
export async function POST(request: Request) {
  const candidates = itemChatInternalSecrets();
  if (candidates.length === 0) {
    console.error(
      "[item-chat/bind-thread] missing SEGNA_INTERNAL_ITEM_CHAT_SECRET (and N8N_ITEM_CHAT_WEBHOOK_SECRET)",
    );
    return NextResponse.json(
      { ok: false as const, error: "internal_secret_not_configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: { conversation_id?: unknown; discord_thread_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  const discordThreadId =
    typeof body.discord_thread_id === "string" ? body.discord_thread_id.trim() : "";

  if (!UUID_RE.test(conversationId) || !discordThreadId) {
    return NextResponse.json({ ok: false as const, error: "invalid_payload" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const conversation = await bindDiscordThread({
    admin,
    conversationId,
    discordThreadId,
  });
  if (!conversation) {
    return NextResponse.json(
      { ok: false as const, error: "conversation_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true as const,
    conversation_id: conversation.id,
    discord_thread_id: conversation.discord_thread_id,
  });
}
