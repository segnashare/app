import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { parseSendcloudLinkHeader } from "@/lib/sendcloud/pagination";

function basicAuthHeader(env: SendcloudEnv): string {
  const token = Buffer.from(`${env.publicKey}:${env.secretKey}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export type SendcloudFetchResult<T> =
  | { ok: true; data: T; status: number; link?: string }
  | { ok: false; status: number; error: string; raw?: unknown };

export async function sendcloudPanelFetch<T>(
  env: SendcloudEnv,
  path: string,
  init?: RequestInit,
): Promise<SendcloudFetchResult<T>> {
  const base = env.panelBaseUrl.replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return sendcloudFetch<T>(env, url, init);
}

export async function sendcloudPanelV3Fetch<T>(
  env: SendcloudEnv,
  path: string,
  init?: RequestInit,
): Promise<SendcloudFetchResult<T>> {
  const v3Base = env.panelBaseUrl.replace(/\/api\/v2\/?$/i, "/api/v3").replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${v3Base}${path.startsWith("/") ? path : `/${path}`}`;
  return sendcloudFetch<T>(env, url, init);
}

export async function sendcloudServicePointsFetch<T>(
  env: SendcloudEnv,
  path: string,
  init?: RequestInit,
): Promise<SendcloudFetchResult<T>> {
  const base = env.servicePointsBaseUrl.replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return sendcloudFetch<T>(env, url, { ...init, redirect: "follow" });
}

async function sendcloudFetch<T>(
  env: SendcloudEnv,
  url: string,
  init?: RequestInit,
): Promise<SendcloudFetchResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: basicAuthHeader(env),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur réseau Sendcloud";
    return { ok: false, status: 0, error: msg };
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const errMsg = extractSendcloudErrorMessage(data) ?? `Sendcloud HTTP ${response.status}`;
    return { ok: false, status: response.status, error: errMsg, raw: data };
  }

  return {
    ok: true,
    data: data as T,
    status: response.status,
    link: response.headers.get("Link") ?? undefined,
  };
}

export async function fetchAllSendcloudV3DataPages<TItem>(
  env: SendcloudEnv,
  path: string,
  init?: RequestInit,
): Promise<SendcloudFetchResult<TItem[]>> {
  const items: TItem[] = [];
  let nextUrl: string | undefined;
  let firstPath = path;

  for (;;) {
    const res = await sendcloudPanelV3Fetch<{ data: TItem[] }>(
      env,
      nextUrl ?? firstPath,
      init,
    );
    if (!res.ok) return res;

    const page = res.data.data ?? [];
    items.push(...page);

    const links = parseSendcloudLinkHeader(res.link);
    if (!links.next) {
      return { ok: true, data: items, status: res.status, link: res.link };
    }
    nextUrl = links.next;
    firstPath = "";
  }
}

function extractSendcloudErrorMessage(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === "string" && data.trim()) return data.trim().slice(0, 400);
  if (typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.message === "string" && o.message.trim()) return o.message.trim().slice(0, 400);
  if (o.error && typeof o.error === "object") {
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message.slice(0, 400);
  }
  if (Array.isArray(o.errors) && o.errors.length > 0) {
    const first = o.errors[0] as Record<string, unknown>;
    const detail = typeof first.detail === "string" ? first.detail : null;
    const status = typeof first.status === "string" ? first.status : null;
    if (detail) return `${status ?? "erreur"} : ${detail}`.slice(0, 400);
  }
  return null;
}
