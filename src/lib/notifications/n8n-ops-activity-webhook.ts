/**
 * Webhook n8n « activité membres » (Discord) :
 * commandes confirmées, comptes créés, abonnements, résiliations.
 *
 * Prefer `N8N_OPS_ACTIVITY_WEBHOOK_URL` ; fallback `N8N_CART_ORDER_WEBHOOK_URL` (legacy).
 */

export type OpsActivityN8nResult =
  | { ok: true }
  | { ok: false; reason: "missing_url" | "http_error" | "network_error"; detail?: string };

/** Tolère un commentaire inline dans `.env` (ex. `https://…/webhook #prod`). */
export function readOpsActivityWebhookUrl(): string {
  const preferred = process.env.N8N_OPS_ACTIVITY_WEBHOOK_URL?.trim() ?? "";
  const legacy = process.env.N8N_CART_ORDER_WEBHOOK_URL?.trim() ?? "";
  const raw = preferred || legacy;
  if (!raw) return "";
  return raw.split("#")[0]?.trim() ?? "";
}

export function readOpsActivityWebhookSecret(): string {
  return (
    process.env.N8N_OPS_ACTIVITY_WEBHOOK_SECRET?.trim() ||
    process.env.N8N_CART_ORDER_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

export async function postOpsActivityN8nWebhook(
  payload: Record<string, unknown>,
  logLabel = "ops-activity",
): Promise<OpsActivityN8nResult> {
  const url = readOpsActivityWebhookUrl();
  if (!url) {
    console.error(`[n8n/${logLabel}] N8N_OPS_ACTIVITY_WEBHOOK_URL / N8N_CART_ORDER_WEBHOOK_URL is not set`);
    return { ok: false, reason: "missing_url" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = readOpsActivityWebhookSecret();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = `${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
      console.warn(`[n8n/${logLabel}] webhook HTTP`, detail);
      return { ok: false, reason: "http_error", detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[n8n/${logLabel}] webhook failed`, detail);
    return { ok: false, reason: "network_error", detail };
  }
}
