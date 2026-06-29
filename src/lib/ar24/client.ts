import { SEGNA_TIMEZONE } from "@/lib/datetime/segna-datetime";
import { ar24DecryptResponse, ar24EncryptDateHeader } from "@/lib/ar24/crypto";

/** Date AR24 : `YYYY-MM-DD HH:mm:ss` en heure de Paris (UTC+1/+2), valable 10 min. */
export function ar24RequestDate(nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SEGNA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export type Ar24Config = {
  apiBaseUrl: string;
  token: string;
  privateKey: string;
  userId: string;
  paymentSlug?: string | null;
  webhookUrl?: string | null;
  dryRun: boolean;
};

export function getAr24Config(opts?: { forceDryRun?: boolean }): Ar24Config | null {
  const token = String(process.env.AR24_API_TOKEN ?? "").trim();
  const privateKey = String(
    process.env.AR24_API_PRIVATE_KEY ?? process.env.AR24_PRIVATE_KEY ?? "",
  ).trim();
  const userId = String(process.env.AR24_API_USER_ID ?? process.env.AR24_USER_ID ?? "").trim();
  const dryRun =
    opts?.forceDryRun === true || process.env.SEGNA_BORROW_FORMAL_NOTICE_DRY_RUN === "1";

  const sandboxDefault = "https://sandbox.ar24.fr/api";
  const prodDefault = "https://www.ar24.fr/api";
  const defaultBase =
    process.env.NODE_ENV === "production" && !process.env.AR24_API_BASE_URL ? prodDefault : sandboxDefault;

  if (!token || !privateKey || !userId) {
    if (dryRun) {
      return {
        apiBaseUrl: String(process.env.AR24_API_BASE_URL ?? sandboxDefault).replace(/\/$/, ""),
        token: "dry-run",
        privateKey: "dry-run",
        userId: "0",
        dryRun: true,
      };
    }
    return null;
  }

  return {
    apiBaseUrl: String(process.env.AR24_API_BASE_URL ?? defaultBase).replace(/\/$/, ""),
    token,
    privateKey,
    userId,
    paymentSlug: process.env.AR24_PAYMENT_SLUG?.trim() || null,
    webhookUrl: process.env.AR24_WEBHOOK_URL?.trim() || null,
    dryRun,
  };
}

export type Ar24ApiResult<T = unknown> = {
  ok: boolean;
  status?: string | null;
  result?: T;
  message?: string | null;
  raw?: unknown;
  date?: string;
};

function parseAr24Response(text: string, date: string, privateKey: string): unknown {
  try {
    const parsed = JSON.parse(text) as { result?: string | unknown; status?: string };
    if (typeof parsed?.result === "string" && parsed.result.length > 0) {
      const decrypted = ar24DecryptResponse(parsed.result, date, privateKey);
      return JSON.parse(decrypted);
    }
    return parsed;
  } catch {
    return text;
  }
}

/** Appel POST form-urlencoded AR24 (token + date dans le body). */
export async function ar24ApiPost(
  config: Ar24Config,
  path: string,
  fields: Record<string, string | number | boolean | null | undefined>,
  nowMs: number = Date.now(),
): Promise<Ar24ApiResult> {
  if (config.dryRun) {
    return { ok: true, status: "dry_run", result: { dryRun: true }, date: ar24RequestDate(nowMs) };
  }

  const date = ar24RequestDate(nowMs);
  const signature = ar24EncryptDateHeader(date, config.privateKey);

  const form = new FormData();
  form.set("token", config.token);
  form.set("date", date);
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    form.set(key, String(value));
  }

  const res = await fetch(`${config.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "POST",
    headers: { signature },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();
  const payload = parseAr24Response(text, date, config.privateKey);
  const body = payload as { status?: string; result?: unknown; message?: string };

  if (body.status === "maintenance") {
    return { ok: false, status: "maintenance", message: "AR24 maintenance", raw: payload, date };
  }

  if (!res.ok || body.status === "ERROR") {
    return {
      ok: false,
      status: body.status ?? `http_${res.status}`,
      message: body.message ?? `ar24_http_${res.status}`,
      raw: payload,
      date,
    };
  }

  return { ok: true, status: body.status ?? "SUCCESS", result: body.result ?? body, raw: payload, date };
}

/** GET AR24 (token + date en query string). */
export async function ar24ApiGet(
  config: Ar24Config,
  path: string,
  query: Record<string, string | number | boolean | null | undefined>,
  nowMs: number = Date.now(),
): Promise<Ar24ApiResult> {
  if (config.dryRun) {
    return { ok: true, status: "dry_run", result: { dryRun: true }, date: ar24RequestDate(nowMs) };
  }

  const date = ar24RequestDate(nowMs);
  const signature = ar24EncryptDateHeader(date, config.privateKey);

  const params = new URLSearchParams();
  params.set("token", config.token);
  params.set("date", date);
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    params.set(key, String(value));
  }

  const url = `${config.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}?${params.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { signature },
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();
  const payload = parseAr24Response(text, date, config.privateKey);
  const body = payload as { status?: string; result?: unknown; message?: string };

  if (!res.ok || body.status === "ERROR") {
    return {
      ok: false,
      status: body.status ?? `http_${res.status}`,
      message: body.message ?? `ar24_http_${res.status}`,
      raw: payload,
      date,
    };
  }

  return { ok: true, status: body.status ?? "SUCCESS", result: body.result ?? body, raw: payload, date };
}

/** Ping API : GET /user pour vérifier token + clé + id_user. */
export async function ar24GetUserInfo(config: Ar24Config): Promise<Ar24ApiResult> {
  return ar24ApiGet(config, "/user", { id_user: config.userId });
}

export function extractAr24MailProofUrl(mail: Record<string, unknown> | null | undefined): string | null {
  if (!mail) return null;
  const candidates = ["proof_ar_url", "proof_ev_url", "pdf_content", "zip"] as const;
  for (const key of candidates) {
    const value = mail[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
