import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bindDiscordThread } from "@/lib/item-chat/service";
import { UUID_RE } from "@/lib/item-chat/types";

function itemChatInternalSecrets(): string[] {
  const primary = process.env.SEGNA_INTERNAL_ITEM_CHAT_SECRET?.trim() ?? "";
  const webhook = process.env.N8N_ITEM_CHAT_WEBHOOK_SECRET?.trim() ?? "";
  return [...new Set([primary, webhook].filter(Boolean))];
}

function readBearer(request: Request): string {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const alt =
    request.headers.get("x-segna-item-chat-secret")?.trim() ||
    request.headers.get("x-api-key")?.trim() ||
    "";
  return alt;
}

function pickString(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/**
 * n8n enregistre le fil Discord après création.
 * Auth : Bearer = `SEGNA_INTERNAL_ITEM_CHAT_SECRET`
 * Body : `{ "conversation_id": "uuid", "discord_thread_id": "…" }`
 * Alias acceptés : `thread_id`, `discordThreadId`, `channel_id` (si = id du fil).
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

  const token = readBearer(request);
  if (!token || !candidates.includes(token)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const conversationId = pickString(body, [
    "conversation_id",
    "conversationId",
    "id",
  ]);
  const discordThreadId = pickString(body, [
    "discord_thread_id",
    "discordThreadId",
    "thread_id",
    "threadId",
    "channel_id",
    "channelId",
  ]);

  if (!UUID_RE.test(conversationId) || !discordThreadId) {
    console.warn("[item-chat/bind-thread] invalid_payload", {
      keys: Object.keys(body),
      conversationIdPresent: Boolean(conversationId),
      threadIdPresent: Boolean(discordThreadId),
    });
    return NextResponse.json({ ok: false as const, error: "invalid_payload" }, { status: 400 });
  }

  try {
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

    console.info("[item-chat/bind-thread] bound", {
      conversation_id: conversation.id,
      discord_thread_id: conversation.discord_thread_id,
    });

    return NextResponse.json({
      ok: true as const,
      conversation_id: conversation.id,
      discord_thread_id: conversation.discord_thread_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
