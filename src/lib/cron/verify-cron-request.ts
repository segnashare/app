import { NextResponse } from "next/server";

import { getCronRouteBearerSecret } from "@/lib/config/env";

export function verifyCronRequest(request: Request): NextResponse | null {
  const expected = getCronRouteBearerSecret();
  if (!expected) {
    return NextResponse.json({ ok: false as const, error: "cron_secret_not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  return null;
}
