import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  appendStaffMessage,
  bindDiscordThread,
  normalizeMessageBody,
  normalizeStaffAvatarUrl,
  normalizeStaffDisplayName,
} from "@/lib/item-chat/service";
import { UUID_RE } from "@/lib/item-chat/types";

function itemChatInternalSecrets(): string[] {
  const primary = process.env.SEGNA_INTERNAL_ITEM_CHAT_SECRET?.trim() ?? "";
  const webhook = process.env.N8N_ITEM_CHAT_WEBHOOK_SECRET?.trim() ?? "";
  return [...new Set([primary, webhook].filter(Boolean))];
}

/**
 * Réponse staff depuis n8n (après message Discord).
 * Auth : Bearer = `SEGNA_INTERNAL_ITEM_CHAT_SECRET` (ou `N8N_ITEM_CHAT_WEBHOOK_SECRET`).
 * Body : `{ "conversation_id", "body", "external_id"?, "discord_thread_id"?, "staff_display_name"?, "staff_avatar_url"? }`
 * Si `discord_thread_id` est fourni, le fil est lié (utile si le bind dédié a échoué).
 */
export async function POST(request: Request) {
  const candidates = itemChatInternalSecrets();
  if (candidates.length === 0) {
    console.error(
      "[item-chat/reply] missing SEGNA_INTERNAL_ITEM_CHAT_SECRET (and N8N_ITEM_CHAT_WEBHOOK_SECRET)",
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

  let body: {
    conversation_id?: unknown;
    body?: unknown;
    external_id?: unknown;
    discord_thread_id?: unknown;
    staff_display_name?: unknown;
    staff_avatar_url?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false as const, error: "invalid_json" }, { status: 400 });
  }

  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  const messageBody = normalizeMessageBody(body.body);
  const externalId =
    typeof body.external_id === "string" && body.external_id.trim()
      ? body.external_id.trim()
      : null;
  const discordThreadId =
    typeof body.discord_thread_id === "string" && body.discord_thread_id.trim()
      ? body.discord_thread_id.trim()
      : null;
  const staffDisplayName = normalizeStaffDisplayName(body.staff_display_name);
  const staffAvatarUrl = normalizeStaffAvatarUrl(body.staff_avatar_url);

  if (!UUID_RE.test(conversationId) || !messageBody) {
    return NextResponse.json({ ok: false as const, error: "invalid_payload" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    if (discordThreadId) {
      await bindDiscordThread({
        admin,
        conversationId,
        discordThreadId,
      });
    }
    const result = await appendStaffMessage({
      admin,
      conversationId,
      body: messageBody,
      externalId,
      staffDisplayName,
      staffAvatarUrl,
    });
    if (!result) {
      return NextResponse.json(
        { ok: false as const, error: "conversation_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true as const,
      message: result.message,
      conversation_id: result.conversation.id,
      discord_thread_id: result.conversation.discord_thread_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
