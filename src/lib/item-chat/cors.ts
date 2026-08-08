import { NextResponse } from "next/server";

import { getItemChatCorsOrigins } from "@/lib/item-chat/config";

function resolveItemChatAllowOrigin(origin: string): string {
  const allowed = getItemChatCorsOrigins();
  if (!origin) return allowed[0]!;
  if (allowed.includes(origin)) return origin;
  // Expo tunnel / Expo Go web preview / local Metro
  if (
    /\.exp\.direct$/i.test(origin) ||
    /\.expo\.dev$/i.test(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  ) {
    return origin;
  }
  return allowed[0]!;
}

export function itemChatCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin")?.trim() || "";
  const allowOrigin = resolveItemChatAllowOrigin(origin);
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
