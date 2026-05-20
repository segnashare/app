import { memberCartDisputeCategoryLabel } from "@/lib/disputes/member-cart-dispute-categories";
import type { MemberCartDisputeReportKind } from "@/lib/disputes/member-cart-dispute-categories";

export type CartDisputeN8nNotifyInput = {
  cartId: string;
  disputeId: string;
  userId: string;
  userEmail: string | null;
  details: string;
  category: string;
  scope: string;
  reportKind: MemberCartDisputeReportKind;
  reason: string;
  itemIds: string[];
  photoPaths: string[];
  cartStatus: string | null;
  updated: boolean;
};

export type CartDisputeN8nNotifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_url" | "http_error" | "network_error"; detail?: string };

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Tolère un commentaire inline dans `.env` (ex. `https://…/dispute #dev`). */
function readDisputeWebhookUrl(): string {
  const raw = process.env.N8N_DISPUTE_WEBHOOK_URL?.trim() ?? "";
  if (!raw) return "";
  return raw.split("#")[0]?.trim() ?? "";
}

/**
 * Déclenche le workflow n8n (`N8N_DISPUTE_WEBHOOK_URL`) après enregistrement d’un litige panier.
 * Doit être await côté API : un `fetch` fire-and-forget est souvent coupé à la fin de la requête Next.js.
 */
export async function notifyCartDisputeN8n(
  input: CartDisputeN8nNotifyInput,
): Promise<CartDisputeN8nNotifyResult> {
  const url = readDisputeWebhookUrl();
  if (!url) {
    console.error("[n8n/dispute] N8N_DISPUTE_WEBHOOK_URL is not set");
    return { ok: false, reason: "missing_url" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.N8N_DISPUTE_WEBHOOK_SECRET?.trim();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const payload = {
    event: input.updated ? "cart_dispute_updated" : "cart_dispute_opened",
    cart_id: input.cartId,
    dispute_id: input.disputeId,
    order_number_compact: formatOrderNumberCompact(input.cartId),
    user_id: input.userId,
    user_email: input.userEmail,
    details: input.details,
    category: input.category,
    category_label: memberCartDisputeCategoryLabel(input.category, input.reportKind),
    scope: input.scope,
    item_ids: input.itemIds,
    photo_paths: input.photoPaths,
    report_kind: input.reportKind,
    reason: input.reason,
    cart_status: input.cartStatus,
    updated: input.updated,
    reported_at: new Date().toISOString(),
  };

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
      console.warn("[n8n/dispute] webhook HTTP", detail);
      return { ok: false, reason: "http_error", detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[n8n/dispute] webhook failed", detail);
    return { ok: false, reason: "network_error", detail };
  }
}
