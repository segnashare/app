import { NextResponse } from "next/server";

import { getItemChatCorsOrigins } from "@/lib/item-chat/config";

export function itemChatCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin")?.trim() || "";
  const allowed = getItemChatCorsOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0]!;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Segna-Chat-Visitor",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function itemChatOptions(request: Request) {
  return new NextResponse(null, { status: 204, headers: itemChatCorsHeaders(request) });
}

export function itemChatJson(request: Request, body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: itemChatCorsHeaders(request),
  });
}
