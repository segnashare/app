import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { listSendcloudShipments } from "@/lib/sendcloud/shipments";

export type ParcelDocumentType = "label" | "customs-declaration" | "air-waybill";
export type ParcelDocumentPaperSize = "A4" | "A5" | "A6";
export type ParcelDocumentMime = "application/pdf" | "application/zpl" | "image/png";

export function buildSendcloudParcelDocumentUrl(
  env: SendcloudEnv,
  parcelId: number,
  type: ParcelDocumentType = "label",
): string {
  const base = env.panelBaseUrl.replace(/\/api\/v2\/?$/i, "/api/v3").replace(/\/$/, "");
  return `${base}/parcels/${parcelId}/documents/${type}`;
}

function basicAuthHeader(env: SendcloudEnv): string {
  return `Basic ${Buffer.from(`${env.publicKey}:${env.secretKey}`, "utf8").toString("base64")}`;
}

export async function downloadSendcloudParcelDocument(
  env: SendcloudEnv,
  parcelId: number,
  options: {
    type?: ParcelDocumentType;
    mimeType?: ParcelDocumentMime;
    dpi?: 72 | 150 | 203 | 300 | 600;
    paperSize?: ParcelDocumentPaperSize;
  } = {},
): Promise<{ ok: true; buffer: Buffer; contentType: string } | { ok: false; error: string }> {
  const type = options.type ?? "label";
  const qs = new URLSearchParams();
  if (options.paperSize) qs.set("paper_size", options.paperSize);
  if (options.dpi) qs.set("dpi", String(options.dpi));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const url = buildSendcloudParcelDocumentUrl(env, parcelId, type) + suffix;
  const accept = options.mimeType ?? "application/pdf";

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: accept,
        Authorization: basicAuthHeader(env),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: `Sendcloud document HTTP ${res.status}` };
    }
    const contentType = res.headers.get("content-type") ?? accept;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer, contentType };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur réseau";
    return { ok: false, error: msg };
  }
}

export async function downloadSendcloudParcelDocumentsBulk(
  env: SendcloudEnv,
  parcelIds: number[],
  type: ParcelDocumentType = "label",
  paperSize?: ParcelDocumentPaperSize,
): Promise<{ ok: true; buffer: Buffer; contentType: string } | { ok: false; error: string }> {
  if (parcelIds.length === 0) {
    return { ok: false, error: "Aucun colis fourni." };
  }
  const qs = new URLSearchParams();
  for (const id of parcelIds.slice(0, 20)) {
    qs.append("parcels", String(id));
  }
  if (paperSize) qs.set("paper_size", paperSize);

  const base = env.panelBaseUrl.replace(/\/api\/v2\/?$/i, "/api/v3").replace(/\/$/, "");
  const url = `${base}/parcel-documents/${type}?${qs.toString()}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/pdf",
        Authorization: basicAuthHeader(env),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: `Sendcloud bulk documents HTTP ${res.status}` };
    }
    const contentType = res.headers.get("content-type") ?? "application/pdf";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer, contentType };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur réseau";
    return { ok: false, error: msg };
  }
}

/** Résout le lien document depuis GET /shipments?ids=… */
export async function fetchParcelDocumentMetadata(
  env: SendcloudEnv,
  parcelId: number,
  type: ParcelDocumentType,
): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const listed = await listSendcloudShipments(env, { parcelIds: [parcelId], pageSize: 5 });
  if (!listed.ok) return { ok: false, error: listed.error };

  for (const shipment of listed.shipments) {
    const parcels = shipment.parcels ?? [];
    for (const parcel of parcels) {
      if (parcel.id !== parcelId) continue;
      for (const doc of parcel.documents ?? []) {
        const link = typeof doc.link === "string" ? doc.link.trim() : "";
        if (!link) continue;
        const kind = (doc.document_type ?? doc.type ?? "").toLowerCase();
        if (kind === type || link.includes(`/documents/${type}`)) {
          return { ok: true, link };
        }
      }
    }
  }
  return { ok: true, link: buildSendcloudParcelDocumentUrl(env, parcelId, type) };
}
