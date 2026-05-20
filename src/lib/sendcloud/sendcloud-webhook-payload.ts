export type SendcloudWebhookPayload = Record<string, unknown>;

function asRecord(v: unknown): SendcloudWebhookPayload | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as SendcloudWebhookPayload;
}

function readNested(obj: SendcloudWebhookPayload | null, path: string): unknown {
  if (!obj) return null;
  const keys = path.split(".");
  let cur: unknown = obj;
  for (const key of keys) {
    const rec = asRecord(cur);
    if (!rec) return null;
    cur = rec[key];
  }
  return cur;
}

export function extractSendcloudOrderNumber(payload: SendcloudWebhookPayload): string | null {
  const candidates: unknown[] = [
    payload.order_number,
    readNested(payload, "parcel.order_number"),
    readNested(payload, "data.order_number"),
    readNested(payload, "data.parcel.order_number"),
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s) return s;
  }
  return null;
}

export function extractSendcloudParcelId(payload: SendcloudWebhookPayload): number | null {
  const candidates: unknown[] = [
    payload.parcel_id,
    payload.id,
    readNested(payload, "parcel.id"),
    readNested(payload, "data.parcel_id"),
    readNested(payload, "data.parcel.id"),
    readNested(payload, "data.id"),
    readNested(payload, "event.data.parcel_id"),
    readNested(payload, "event.data.parcel.id"),
  ];
  for (const c of candidates) {
    const n = typeof c === "number" ? c : typeof c === "string" ? parseInt(c, 10) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function extractSendcloudStatus(payload: SendcloudWebhookPayload): {
  statusId: number;
  statusMessage: string;
} {
  const statusObj = asRecord(payload.status) ?? asRecord(readNested(payload, "parcel.status"));
  const statusId = Number(
    payload.status_id ??
      statusObj?.id ??
      readNested(payload, "data.status.id") ??
      readNested(payload, "parcel.status.id") ??
      0,
  );
  const statusMessage = String(
    payload.status_message ??
      statusObj?.message ??
      readNested(payload, "data.status.message") ??
      readNested(payload, "parcel.status.message") ??
      "",
  ).trim();
  return { statusId, statusMessage };
}

export function extractSendcloudTracking(payload: SendcloudWebhookPayload): {
  trackingNumber: string | null;
  trackingUrl: string | null;
} {
  const trackingNumberRaw =
    payload.tracking_number ??
    readNested(payload, "parcel.tracking_number") ??
    readNested(payload, "data.tracking_number");
  const trackingUrlRaw =
    payload.tracking_url ??
    readNested(payload, "parcel.tracking_url") ??
    readNested(payload, "data.tracking_url");

  const trackingNumber = typeof trackingNumberRaw === "string" ? trackingNumberRaw.trim() : "";
  const trackingUrl = typeof trackingUrlRaw === "string" ? trackingUrlRaw.trim() : "";

  return {
    trackingNumber: trackingNumber || null,
    trackingUrl:
      trackingUrl.startsWith("http://") || trackingUrl.startsWith("https://") ? trackingUrl : null,
  };
}

export function extractSendcloudLabelUrl(payload: SendcloudWebhookPayload): string | null {
  const candidates: unknown[] = [
    payload.label_url,
    readNested(payload, "parcel.label_url"),
    readNested(payload, "data.label_url"),
    readNested(payload, "label.label_printer"),
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().startsWith("http")) return c.trim();
    if (Array.isArray(c) && typeof c[0] === "string" && c[0].trim().startsWith("http")) {
      return c[0].trim();
    }
  }
  const docs = readNested(payload, "parcel.documents") ?? readNested(payload, "documents");
  if (Array.isArray(docs)) {
    for (const d of docs) {
      const rec = asRecord(d);
      const link = typeof rec?.link === "string" ? rec.link.trim() : "";
      if (link.startsWith("http") && link.includes("/documents/label")) {
        return link;
      }
    }
  }
  return null;
}
