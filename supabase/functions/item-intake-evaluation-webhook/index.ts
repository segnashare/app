/**
 * Appelée par un **Database Webhook** Supabase sur `public.item_intake`.
 * Quand `listing_stage` **devient** `evaluation`, on notifie n8n (enrichissement pièce).
 *
 * Config dashboard Supabase: Database → Webhooks → table `item_intake`, events INSERT + UPDATE.
 * URL: `https://<ref>.supabase.co/functions/v1/item-intake-evaluation-webhook`
 * Header: `X-Webhook-Secret: <même valeur que le secret (ITEM_INTAKE_WEBHOOK_SECRET)>`
 * JWT désactivé sur la function (`verify_jwt = false` dans `config.toml`).
 */
import { timingSafeEqual } from "node:crypto";

type DbWebhookRow = {
  item_id?: string;
  listing_stage?: string;
  [key: string]: unknown;
};

type SupabaseDatabaseWebhookBody = {
  type?: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  schema?: string;
  record?: DbWebhookRow | null;
  old_record?: DbWebhookRow | null;
};

function isTransitionToEvaluation(
  op: "INSERT" | "UPDATE" | "DELETE" | undefined,
  record: DbWebhookRow | null | undefined,
  oldRecord: DbWebhookRow | null | undefined,
): boolean {
  if (record?.listing_stage !== "evaluation") return false;
  if (op === "INSERT") return true;
  if (op === "UPDATE") {
    return oldRecord?.listing_stage !== "evaluation";
  }
  return false;
}

function secretsEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  return timingSafeEqual(ea, eb);
}

function verifyCallerSecret(req: Request, expected: string | undefined): boolean {
  if (!expected?.length) return false;
  const header = req.headers.get("x-webhook-secret") ?? "";
  return header.length > 0 && secretsEqual(header, expected);
}

Deno.serve(async (req) => {
  if (req.method === "GET" || req.method === "HEAD") {
    return new Response("ok", { status: 200 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("ITEM_INTAKE_WEBHOOK_SECRET")?.trim();
  if (!expectedSecret || !verifyCallerSecret(req, expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const n8nUrl = Deno.env.get("N8N_INBOUND_URL")?.trim();
  if (!n8nUrl) {
    return Response.json({ ok: false, error: "N8N_INBOUND_URL is not set" }, { status: 500 });
  }

  let body: SupabaseDatabaseWebhookBody;
  try {
    body = (await req.json()) as SupabaseDatabaseWebhookBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (body.table != null && String(body.table) !== "item_intake") {
    return Response.json({ ok: true, skipped: true, reason: "not_item_intake_table" }, { status: 200 });
  }

  const op = body.type;
  const record = body.record;
  const oldRecord = body.old_record;

  if (op === "DELETE" || !record) {
    return Response.json({ ok: true, skipped: true, reason: "no_relevant_op" }, { status: 200 });
  }

  if (!isTransitionToEvaluation(op, record, oldRecord)) {
    return Response.json(
      { ok: true, skipped: true, reason: "not_transition_to_evaluation", listing_stage: record.listing_stage },
      { status: 200 },
    );
  }

  const itemId = typeof record.item_id === "string" ? record.item_id.trim() : "";
  if (!itemId) {
    return Response.json({ ok: false, error: "missing item_id" }, { status: 400 });
  }

  const n8nPayload = {
    event: "item_intake.listing_stage.evaluation",
    item_id: itemId,
    at: new Date().toISOString(),
    supabase: {
      type: op,
      item_intake: record,
      previous_listing_stage: oldRecord?.listing_stage ?? null,
    },
  };

  const n8nHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const bearer = Deno.env.get("N8N_INBOUND_BEARER");
  if (bearer?.trim()) {
    n8nHeaders.Authorization = `Bearer ${bearer.trim()}`;
  }

  const n8nRes = await fetch(n8nUrl, {
    method: "POST",
    headers: n8nHeaders,
    body: JSON.stringify(n8nPayload),
  });

  if (!n8nRes.ok) {
    const errText = await n8nRes.text().catch(() => "");
    return Response.json(
      { ok: false, error: "n8n_request_failed", status: n8nRes.status, detail: errText.slice(0, 500) },
      { status: 502 },
    );
  }

  return Response.json(
    { ok: true, forwarded: true, item_id: itemId, n8n_status: n8nRes.status },
    { status: 200 },
  );
});
