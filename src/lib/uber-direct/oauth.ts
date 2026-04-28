import type { UberDirectEnvConfig } from "@/lib/uber-direct/config";

const TOKEN_URL = "https://auth.uber.com/oauth/v2/token";
const SCOPE = "eats.deliveries";

type Cached = { token: string; expiresAtMs: number };
let cached: Cached | null = null;

function bodyUrlEncode(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

export async function getUberDirectAccessToken(config: UberDirectEnvConfig): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAtMs > now + 60_000) {
    return cached.token;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyUrlEncode({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      scope: SCOPE,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`uber_oauth_${res.status}: ${raw.slice(0, 400)}`);
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  } catch {
    throw new Error("uber_oauth_invalid_json");
  }

  const token = typeof parsed.access_token === "string" ? parsed.access_token : "";
  if (!token) {
    throw new Error("uber_oauth_missing_token");
  }

  const expiresInSec = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
  cached = {
    token,
    expiresAtMs: now + Math.max(120, expiresInSec) * 1000,
  };
  return token;
}
