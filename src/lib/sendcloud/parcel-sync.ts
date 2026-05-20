import { createHash } from "node:crypto";

import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelFetch } from "@/lib/sendcloud/client";
import {
  fetchSendcloudParcelV3,
  isSendcloudParcelCancelled,
  type SendcloudShipmentParcel,
} from "@/lib/sendcloud/shipments";

export const SENDCLOUD_PARCEL_STATUS_CANCELLED = 2000;

export function parseSendcloudParcelIdFromLabelUrl(labelUrl: string): number | null {
  const u = labelUrl.trim();
  if (!u) return null;
  const m =
    u.match(/\/parcels\/(\d+)\/documents\/label/i) ||
    u.match(/\/labels\/normal_printer\/(\d+)/i) ||
    u.match(/\/labels\/label_printer\/(\d+)/i) ||
    u.match(/\/labels\/[^/]+\/(\d+)/i);
  if (!m?.[1]) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function buildSendcloudOrderNumber(params: {
  cartId: string;
  shipmentId: string;
  generation: number;
}): string {
  const cart8 = params.cartId.replace(/-/g, "").slice(0, 8);
  const ship8 = createHash("sha256").update(params.shipmentId).digest("hex").slice(0, 8);
  const gen = Math.max(1, params.generation);
  if (gen <= 1) {
    return `segna-${cart8}-${ship8}`;
  }
  return `segna-${cart8}-${ship8}-g${gen}`;
}

export type SendcloudParcelSnapshot = {
  id: number;
  orderNumber: string;
  statusId: number;
  statusMessage: string;
  isCancelled: boolean;
  trackingNumber: string;
  trackingUrl: string | null;
};

function mapV3ParcelRow(p: SendcloudShipmentParcel): SendcloudParcelSnapshot {
  const statusMessage = String(p.status?.message ?? "").trim();
  return {
    id: Number(p.id),
    orderNumber: "",
    statusId: 0,
    statusMessage,
    isCancelled: isSendcloudParcelCancelled(p),
    trackingNumber: String(p.tracking_number ?? "").trim(),
    trackingUrl:
      typeof p.tracking_url === "string" && p.tracking_url.trim().startsWith("http")
        ? p.tracking_url.trim()
        : null,
  };
}

function mapParcelRow(p: Record<string, unknown>): SendcloudParcelSnapshot {
  const status = (p.status as Record<string, unknown> | undefined) ?? {};
  const statusId = Number(status.id ?? 0);
  const statusMessage = String(status.message ?? "").trim();

  return {
    id: Number(p.id),
    orderNumber: String(p.order_number ?? "").trim(),
    statusId,
    statusMessage,
    isCancelled:
      statusId === SENDCLOUD_PARCEL_STATUS_CANCELLED ||
      statusMessage.toLowerCase().includes("cancel"),
    trackingNumber: String(p.tracking_number ?? "").trim(),
    trackingUrl:
      typeof p.tracking_url === "string" && p.tracking_url.trim().startsWith("http")
        ? p.tracking_url.trim()
        : null,
  };
}

export async function fetchSendcloudParcel(
  env: SendcloudEnv,
  parcelId: number,
): Promise<SendcloudParcelSnapshot | null> {
  const v3 = await fetchSendcloudParcelV3(env, parcelId);
  if (v3) return mapV3ParcelRow(v3);

  const res = await sendcloudPanelFetch<{ parcel: Record<string, unknown> }>(
    env,
    `/parcels/${parcelId}`,
    { method: "GET" },
  );
  if (!res.ok) return null;
  return mapParcelRow(res.data.parcel);
}
