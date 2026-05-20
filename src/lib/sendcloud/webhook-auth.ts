import { createHmac, timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function webhookSecrets(): string[] {
  return [
    process.env.SENDCLOUD_WEBHOOK_SECRET?.trim() ?? "",
    process.env.SENDCLOUD_SECRET_KEY?.trim() ?? "",
  ].filter(Boolean);
}

/** Webhook intégration Sendcloud : HMAC SHA-256 du corps brut vs en-tête `Sendcloud-Signature`. */
export function isSendcloudIntegrationWebhookAuthorized(request: Request, rawBody: string): boolean {
  const signature = request.headers.get("Sendcloud-Signature")?.trim() ?? "";
  if (!signature || !rawBody) return false;

  for (const secret of webhookSecrets()) {
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    if (safeEqual(expected.toLowerCase(), signature.toLowerCase())) return true;
  }
  return false;
}

/** Event Subscriptions : `Authorization: Bearer` ou en-tête API key. */
export function isSendcloudEventSubscriptionAuthorized(request: Request): boolean {
  const secrets = webhookSecrets();
  if (secrets.length === 0) return false;

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token && secrets.some((secret) => safeEqual(token, secret))) return true;
  }

  const headerName = process.env.SENDCLOUD_WEBHOOK_API_KEY_HEADER?.trim() || "X-Api-Key";
  const apiKey = request.headers.get(headerName)?.trim() ?? "";
  if (apiKey && secrets.some((secret) => safeEqual(apiKey, secret))) return true;

  return false;
}

/**
 * Auth webhook Sendcloud : HMAC intégration (corps brut) ou Bearer / API key (Event Subscriptions).
 */
export function isSendcloudWebhookAuthorized(request: Request, rawBody?: string): boolean {
  if (rawBody !== undefined && isSendcloudIntegrationWebhookAuthorized(request, rawBody)) {
    return true;
  }
  return isSendcloudEventSubscriptionAuthorized(request);
}
