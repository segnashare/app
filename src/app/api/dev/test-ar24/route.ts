import { NextResponse } from "next/server";

import { ar24CryptoSelfTest } from "@/lib/ar24/crypto";
import { ar24GetUserInfo, ar24RequestDate, getAr24Config } from "@/lib/ar24/client";

/**
 * Dev : vérifie crypto AR24 + ping GET /user (token, clé privée, id_user).
 *
 * GET /api/dev/test-ar24
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ ok: false, error: "dev_only" }, { status: 403 });
  }

  try {
    ar24CryptoSelfTest();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, step: "crypto_self_test", error: msg }, { status: 500 });
  }

  const config = getAr24Config();
  if (!config) {
    return NextResponse.json({
      ok: false,
      step: "config",
      crypto: "ok",
      error: "missing_credentials",
      hint: "Ajoute AR24_API_TOKEN, AR24_API_PRIVATE_KEY, AR24_API_USER_ID dans .env.local",
      paris_date_sample: ar24RequestDate(),
    });
  }

  if (config.dryRun) {
    return NextResponse.json({
      ok: true,
      crypto: "ok",
      dry_run: true,
      api_base_url: config.apiBaseUrl,
      paris_date_sample: ar24RequestDate(),
    });
  }

  const user = await ar24GetUserInfo(config);
  return NextResponse.json({
    ok: user.ok,
    crypto: "ok",
    api_base_url: config.apiBaseUrl,
    user_id: config.userId,
    paris_date_used: user.date,
    ar24_status: user.status,
    ar24_message: user.message ?? null,
    user: user.result ?? null,
    raw: user.ok ? undefined : user.raw,
  });
}
