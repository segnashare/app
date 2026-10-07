import { NextResponse } from "next/server";

import { getCronRouteBearerSecret } from "@/lib/config/env";
import { bearerMatches } from "@/lib/security/safe-equal";

export function verifyCronRequest(request: Request): NextResponse | null {
  const expected = getCronRouteBearerSecret();
  if (!expected) {
    return NextResponse.json({ ok: false as const, error: "cron_secret_not_configured" }, { status: 503 });
  }

  if (!bearerMatches(request, expected)) {
    return NextResponse.json({ ok: false as const, error: "unauthorized" }, { status: 401 });
  }

  return null;
}
