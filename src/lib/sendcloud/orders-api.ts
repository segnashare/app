import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelFetch, sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";
import {
  buildSendcloudOrderItemsFromLines,
  type SendcloudOrderItemInput,
} from "@/lib/sendcloud/build-sendcloud-order-items";
import type { SendcloudOutboundRecipient } from "@/lib/sendcloud/shipments";

export type SendcloudOrder = {
  id?: string;
  order_id?: string;
  order_number?: string;
};

/** Commande importée Sendcloud, sans étiquette (création au paiement panier). */
export function buildSegnaSendcloudOrderRowForProvision(input: {
  orderId: string;
  orderNumber: string;
  integrationId: number;
  shippingOptionCode: string;
  recipient: SendcloudOutboundRecipient;
  servicePointId?: number | null;
  toPostNumber?: string | null;
  /** Une ligne par pièce (défaut : placeholder minimal si vide). */
  orderItemLines?: SendcloudOrderItemInput[];
}): Record<string, unknown> {
  const { orderItems, totalValueEur } = buildSendcloudOrderItemsFromLines(input.orderItemLines ?? []);

  const orderRow: Record<string, unknown> = {
    order_id: input.orderId,
    order_number: input.orderNumber,
    order_details: {
      integration: { id: input.integrationId },
      status: { code: "open", message: "Open" },
      order_created_at: new Date().toISOString(),
      order_items: orderItems,
    },
    payment_details: {
      total_price: { value: totalValueEur, currency: "EUR" },
      status: { code: "paid", message: "Paid" },
    },
    shipping_address: {
      name: input.recipient.name.slice(0, 64),
      address_line_1: input.recipient.addressLine1.slice(0, 64),
      house_number: input.recipient.houseNumber.slice(0, 16) || "1",
      postal_code: input.recipient.postalCode,
      city: input.recipient.city.slice(0, 64),
      country_code: input.recipient.countryCode.toUpperCase(),
      phone_number: input.recipient.phone.slice(0, 32),
      email: input.recipient.email.slice(0, 128),
    },
    shipping_details: {
      ship_with: {
        type: "shipping_option_code",
        properties: { shipping_option_code: input.shippingOptionCode.trim() },
      },
    },
  };

  if (input.servicePointId != null && input.servicePointId > 0) {
    const sp: Record<string, string> = { id: String(input.servicePointId) };
    const post = input.toPostNumber?.trim();
    if (post) sp.post_number = post;
    orderRow.service_point_details = sp;
  }

  return orderRow;
}

/** @deprecated Préférer `buildSegnaSendcloudOrderRowForProvision` (relais fixe). */
export function buildSegnaSendcloudOrderRow(input: {
  orderId: string;
  orderNumber: string;
  integrationId: number;
  shippingOptionCode: string;
  recipient: SendcloudOutboundRecipient;
  servicePointId: number;
  orderItemLines?: SendcloudOrderItemInput[];
}): Record<string, unknown> {
  return buildSegnaSendcloudOrderRowForProvision({
    ...input,
    servicePointId: input.servicePointId,
    orderItemLines: input.orderItemLines,
  });
}

export async function upsertSendcloudOrders(
  env: SendcloudEnv,
  orders: Record<string, unknown>[],
): Promise<{ ok: true; orders: SendcloudOrder[] } | { ok: false; error: string }> {
  const res = await sendcloudPanelV3Fetch<{ data: SendcloudOrder[] }>(env, "/orders", {
    method: "POST",
    body: JSON.stringify(orders),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, orders: res.data.data ?? [] };
}

export async function listSendcloudOrders(
  env: SendcloudEnv,
  query: { integrationId?: number; orderNumber?: string; pageSize?: number },
): Promise<{ ok: true; orders: SendcloudOrder[] } | { ok: false; error: string }> {
  const qs = new URLSearchParams();
  if (query.integrationId) qs.set("integration", String(query.integrationId));
  if (query.orderNumber?.trim()) qs.set("order_number", query.orderNumber.trim());
  if (query.pageSize) qs.set("page_size", String(Math.min(50, Math.max(1, query.pageSize))));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await sendcloudPanelV3Fetch<{ data: SendcloudOrder[] }>(env, `/orders${suffix}`, {
    method: "GET",
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, orders: res.data.data ?? [] };
}

export async function findSendcloudOrderByNumber(
  env: SendcloudEnv,
  orderNumber: string,
  integrationId?: number,
): Promise<SendcloudOrder | null> {
  const listed = await listSendcloudOrders(env, {
    orderNumber,
    integrationId,
    pageSize: 5,
  });
  if (!listed.ok) return null;
  const on = orderNumber.trim().toLowerCase();
  return (
    listed.orders.find((o) => String(o.order_number ?? "").trim().toLowerCase() === on) ?? null
  );
}

export async function deleteSendcloudOrder(
  env: SendcloudEnv,
  sendcloudOrderId: string | number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await sendcloudPanelV3Fetch<unknown>(
    env,
    `/orders/${encodeURIComponent(String(sendcloudOrderId))}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    if (res.status === 404) return { ok: true };
    return { ok: false, error: res.error };
  }
  return { ok: true };
}

export async function cancelSendcloudParcelV2(
  env: SendcloudEnv,
  parcelId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await sendcloudPanelFetch<{ parcel?: { status?: { message?: string } } }>(
    env,
    `/parcels/${parcelId}/cancel`,
    { method: "POST" },
  );
  if (!res.ok) {
    if (res.status === 409 || res.status === 404) return { ok: true };
    return { ok: false, error: res.error };
  }
  return { ok: true };
}

/** Annulation colis créés via l’API v3 (`/shipments/announce`). */
export async function cancelSendcloudParcelV3(
  env: SendcloudEnv,
  parcelId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await sendcloudPanelV3Fetch<{ data?: { status?: string } }>(
    env,
    `/parcels/${parcelId}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!res.ok) {
    if (res.status === 409 || res.status === 404) return { ok: true };
    return { ok: false, error: res.error };
  }
  return { ok: true };
}

export async function cancelSendcloudOutboundParcel(
  env: SendcloudEnv,
  parcelId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const v2 = await cancelSendcloudParcelV2(env, parcelId);
  if (v2.ok) return v2;
  return cancelSendcloudParcelV3(env, parcelId);
}

export async function createSendcloudOrderLabelsAsync(
  env: SendcloudEnv,
  body: {
    integration_id: number;
    orders: { order_number: string; apply_shipping_rules?: boolean }[];
    sender_address_id?: number;
  },
): Promise<{ ok: true; parcelId: number } | { ok: false; error: string }> {
  const res = await sendcloudPanelV3Fetch<{
    data: { parcel_id: number }[];
    errors?: unknown[];
  }>(env, "/orders/create-labels-async", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: res.error };
  const row = res.data.data?.[0];
  if (!row?.parcel_id) {
    const errDetail = res.data.errors ? JSON.stringify(res.data.errors).slice(0, 300) : "";
    return { ok: false, error: `Sendcloud : aucune étiquette créée. ${errDetail}`.trim() };
  }
  return { ok: true, parcelId: row.parcel_id };
}

export async function createSendcloudOrderLabelSync(
  env: SendcloudEnv,
  body: {
    integration_id: number;
    order: { order_number: string; apply_shipping_rules?: boolean };
    sender_address_id?: number;
    ship_with: Record<string, unknown>;
  },
): Promise<
  | { ok: true; parcelId: number; trackingNumber: string; labelUrl: string }
  | { ok: false; error: string }
> {
  const res = await sendcloudPanelV3Fetch<{
    data: {
      parcel_id: number;
      tracking_number?: string;
      documents?: { link?: string; document_type?: string; type?: string }[];
    };
  }>(env, "/orders/create-label-sync", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: res.error };

  const row = res.data.data;
  const docs = row.documents ?? [];
  let labelUrl = "";
  for (const doc of docs) {
    const link = typeof doc.link === "string" ? doc.link.trim() : "";
    if (!link) continue;
    const kind = (doc.document_type ?? doc.type ?? "").toLowerCase();
    if (kind === "label" || link.includes("/documents/label")) {
      labelUrl = link;
      break;
    }
  }
  if (!labelUrl && row.parcel_id > 0) {
    const base = env.panelBaseUrl.replace(/\/api\/v2\/?$/i, "/api/v3").replace(/\/$/, "");
    labelUrl = `${base}/parcels/${row.parcel_id}/documents/label`;
  }
  if (!labelUrl) return { ok: false, error: "Sendcloud : étiquette absente." };

  return {
    ok: true,
    parcelId: row.parcel_id,
    trackingNumber: String(row.tracking_number ?? "").trim(),
    labelUrl,
  };
}
