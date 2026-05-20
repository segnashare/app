import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";

export type SendcloudReturnListItem = {
  id?: number;
  order_number?: string;
  tracking_number?: string | null;
  status?: string;
  created_at?: string;
  is_cancellable?: boolean;
};

function formatSendcloudDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isTerminalReturnStatus(status: string | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return false;
  const terminal = [
    "cancelled",
    "canceled",
    "cancel",
    "delivered",
    "received",
    "request_rejected",
    "payment_failed",
    "returned_to_sender",
    "returned_to_merchant",
  ];
  return terminal.some((t) => s.includes(t));
}

function normalizeTrackingKey(trackingNumber: string): string {
  return trackingNumber.trim().toUpperCase();
}

export async function listSendcloudReturnsPage(
  env: SendcloudEnv,
  params: { from: Date; to: Date; cursor?: string; pageSize?: number },
): Promise<
  | { ok: true; data: SendcloudReturnListItem[]; next: string | null }
  | { ok: false; error: string }
> {
  const qs = new URLSearchParams({
    from_date: formatSendcloudDateTime(params.from),
    to_date: formatSendcloudDateTime(params.to),
    page_size: String(Math.min(Math.max(params.pageSize ?? 40, 1), 40)),
  });
  if (params.cursor?.trim()) {
    qs.set("cursor", params.cursor.trim());
  }

  const res = await sendcloudPanelV3Fetch<{
    data?: SendcloudReturnListItem[];
    next?: string | null;
  }>(env, `/returns?${qs.toString()}`, { method: "GET" });

  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  return {
    ok: true,
    data: Array.isArray(res.data.data) ? res.data.data : [],
    next: typeof res.data.next === "string" && res.data.next.trim() ? res.data.next.trim() : null,
  };
}

export async function findSendcloudReturnsByOrderNumber(
  env: SendcloudEnv,
  orderNumber: string,
  options?: { lookbackDays?: number; maxPages?: number },
): Promise<{ ok: true; returns: SendcloudReturnListItem[] } | { ok: false; error: string }> {
  const on = orderNumber.trim().toLowerCase();
  if (!on) {
    return { ok: true, returns: [] };
  }

  const to = new Date();
  const from = new Date(to.getTime() - (options?.lookbackDays ?? 120) * 24 * 60 * 60 * 1000);
  const maxPages = Math.min(Math.max(options?.maxPages ?? 8, 1), 20);

  const matches: SendcloudReturnListItem[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (page < maxPages) {
    const listed = await listSendcloudReturnsPage(env, { from, to, cursor, pageSize: 40 });
    if (!listed.ok) {
      return listed;
    }

    for (const row of listed.data) {
      const rowOrder = String(row.order_number ?? "")
        .trim()
        .toLowerCase();
      if (rowOrder === on) {
        matches.push(row);
      }
    }

    if (!listed.next) break;
    try {
      const nextUrl = new URL(listed.next);
      cursor = nextUrl.searchParams.get("cursor") ?? undefined;
    } catch {
      break;
    }
    if (!cursor) break;
    page += 1;
  }

  return { ok: true, returns: matches };
}

export async function findSendcloudReturnsByTrackingNumber(
  env: SendcloudEnv,
  trackingNumber: string,
  options?: { lookbackDays?: number; maxPages?: number },
): Promise<{ ok: true; returns: SendcloudReturnListItem[] } | { ok: false; error: string }> {
  const key = normalizeTrackingKey(trackingNumber);
  if (!key) {
    return { ok: true, returns: [] };
  }

  const to = new Date();
  const from = new Date(to.getTime() - (options?.lookbackDays ?? 120) * 24 * 60 * 60 * 1000);
  const maxPages = Math.min(Math.max(options?.maxPages ?? 12, 1), 24);

  const matches: SendcloudReturnListItem[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (page < maxPages) {
    const listed = await listSendcloudReturnsPage(env, { from, to, cursor, pageSize: 40 });
    if (!listed.ok) {
      return listed;
    }

    for (const row of listed.data) {
      const rowTn = normalizeTrackingKey(String(row.tracking_number ?? ""));
      if (rowTn && rowTn === key) {
        matches.push(row);
      }
    }

    if (!listed.next) break;
    try {
      const nextUrl = new URL(listed.next);
      cursor = nextUrl.searchParams.get("cursor") ?? undefined;
    } catch {
      break;
    }
    if (!cursor) break;
    page += 1;
  }

  return { ok: true, returns: matches };
}

export async function cancelSendcloudReturnV3(
  env: SendcloudEnv,
  returnId: number,
): Promise<{ ok: true; message: string } | { ok: false; error: string; status?: number }> {
  if (!Number.isFinite(returnId) || returnId <= 0) {
    return { ok: false, error: "Identifiant retour Sendcloud invalide." };
  }

  const res = await sendcloudPanelV3Fetch<{ message?: string }>(
    env,
    `/returns/${encodeURIComponent(String(returnId))}/cancel`,
    { method: "PATCH", body: JSON.stringify({}) },
  );

  if (!res.ok) {
    return { ok: false, error: res.error, status: res.status };
  }

  return {
    ok: true,
    message: String(res.data.message ?? "Cancellation requested successfully").trim(),
  };
}

async function cancelSendcloudReturnRows(
  env: SendcloudEnv,
  rows: SendcloudReturnListItem[],
): Promise<{ cancelledIds: number[]; lastError: string | null; lastStatus?: number }> {
  const cancelledIds: number[] = [];
  const seen = new Set<number>();
  let lastError: string | null = null;
  let lastStatus: number | undefined;

  for (const row of rows) {
    if (typeof row.id !== "number" || row.id <= 0 || seen.has(row.id)) continue;
    if (isTerminalReturnStatus(row.status)) continue;
    seen.add(row.id);

    const cancelled = await cancelSendcloudReturnV3(env, row.id);
    if (cancelled.ok) {
      cancelledIds.push(row.id);
      continue;
    }
    if (cancelled.status === 409) {
      cancelledIds.push(row.id);
      continue;
    }
    lastError = cancelled.error;
    lastStatus = cancelled.status;
  }

  return { cancelledIds, lastError, lastStatus };
}

export async function cancelSendcloudReturnsForOrderNumber(
  env: SendcloudEnv,
  orderNumber: string,
): Promise<
  | { ok: true; cancelledIds: number[]; skipped: number }
  | { ok: false; error: string; status?: number }
> {
  const found = await findSendcloudReturnsByOrderNumber(env, orderNumber);
  if (!found.ok) {
    return found;
  }

  const { cancelledIds, lastError, lastStatus } = await cancelSendcloudReturnRows(env, found.returns);

  if (lastError && cancelledIds.length === 0) {
    return { ok: false, error: lastError, status: lastStatus };
  }

  return {
    ok: true,
    cancelledIds,
    skipped: Math.max(0, found.returns.length - cancelledIds.length),
  };
}

export async function cancelSendcloudReturnsForTrackingNumbers(
  env: SendcloudEnv,
  trackingNumbers: string[],
): Promise<
  | { ok: true; cancelledIds: number[] }
  | { ok: false; error: string; status?: number }
> {
  const keys = [...new Set(trackingNumbers.map(normalizeTrackingKey).filter(Boolean))];
  if (keys.length === 0) {
    return { ok: true, cancelledIds: [] };
  }

  const allRows: SendcloudReturnListItem[] = [];
  for (const key of keys) {
    const found = await findSendcloudReturnsByTrackingNumber(env, key);
    if (!found.ok) {
      return found;
    }
    allRows.push(...found.returns);
  }

  const { cancelledIds, lastError, lastStatus } = await cancelSendcloudReturnRows(env, allRows);
  if (lastError && cancelledIds.length === 0) {
    return { ok: false, error: lastError, status: lastStatus };
  }
  return { ok: true, cancelledIds: [...new Set(cancelledIds)] };
}
