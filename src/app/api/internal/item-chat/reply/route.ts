import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendStaffMessage, normalizeMessageBody } from "@/lib/item-chat/service";
import { UUID_RE } from "@/lib/item-chat/types";

function itemChatInternalSecrets(): string[] {
  const primary = process.env.SEGNA_INTERNAL_ITEM_CHAT_SECRET?.trim() ?? "";
  const webhook = process.env.N8N_ITEM_CHAT_WEBHOOK_SECRET?.trim() ?? "";
  return [...new Set([primary, webhook].filter(Boolean))];
}

/**
 * Réponse staff depuis n8n (après message Discord).
 * Auth : Bearer = `SEGNA_INTERNAL_ITEM_CHAT_SECRET` (ou `N8N_ITEM_CHAT_WEBHOOK_SECRET`).
 * Body : `{ "conversation_id": "uuid", "body": "...", "external_id"?: "discord-msg-id" }`
 */
export async function POST(request: Request) {
  const candidates = itemChatInternalSecrets();
  if (candidates.length === 0) {
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

  let body: { conversation_id?: unknown; body?: unknown; external_id?: unknown };
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

  if (!UUID_RE.test(conversationId) || !messageBody) {
    return NextResponse.json({ ok: false as const, error: "invalid_payload" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const result = await appendStaffMessage({
      admin,
      conversationId,
      body: messageBody,
      externalId,
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
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false as const, error: msg }, { status: 500 });
  }
}
