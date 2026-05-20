import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";
import { formatSendcloudParcelWeightKg } from "@/lib/shipping/exchange-shipping-pricing";

export type SendcloudOutboundRecipient = {
  name: string;
  addressLine1: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  countryCode: string;
  phone: string;
  email: string;
};

function buildSendcloudAddressNode(recipient: SendcloudOutboundRecipient): Record<string, string> {
  return {
    name: recipient.name.slice(0, 64),
    company_name: "",
    address_line_1: recipient.addressLine1.slice(0, 64),
    house_number: recipient.houseNumber.slice(0, 16) || "1",
    postal_code: recipient.postalCode,
    city: recipient.city.slice(0, 64),
    country_code: recipient.countryCode.toUpperCase(),
    phone_number: recipient.phone.slice(0, 32),
    email: recipient.email.slice(0, 128),
  };
}
function v3ParcelLabelUrl(env: SendcloudEnv, parcelId: number): string {
  const base = env.panelBaseUrl.replace(/\/api\/v2\/?$/i, "/api/v3").replace(/\/$/, "");
  return `${base}/parcels/${parcelId}/documents/label`;
}

export type SendcloudParcelStatus = {
  code?: string;
  message?: string;
};

export type SendcloudParcelDocument = {
  type?: string;
  document_type?: string;
  link?: string;
};

export type SendcloudShipmentParcel = {
  id: number;
  status?: SendcloudParcelStatus;
  documents?: SendcloudParcelDocument[];
  tracking_number?: string;
  tracking_url?: string | null;
};

export type SendcloudShipment = {
  id: string;
  order_number?: string;
  parcels?: SendcloudShipmentParcel[];
  errors?: { code?: string; detail?: string }[];
};

export function resolveParcelLabelUrl(
  env: SendcloudEnv,
  parcel: SendcloudShipmentParcel,
): string | null {
  const docs = parcel.documents ?? [];
  for (const doc of docs) {
    const link = typeof doc.link === "string" ? doc.link.trim() : "";
    if (!link) continue;
    const kind = (doc.document_type ?? doc.type ?? "").toLowerCase();
    if (kind === "label" || link.includes("/documents/label")) return link;
  }
  if (parcel.id > 0) return v3ParcelLabelUrl(env, parcel.id);
  return null;
}

export function isSendcloudParcelCancelled(parcel: SendcloudShipmentParcel): boolean {
  const code = String(parcel.status?.code ?? "").toUpperCase();
  const message = String(parcel.status?.message ?? "").toLowerCase();
  return code === "CANCELLED" || message.includes("cancel");
}

export async function listSendcloudShipments(
  env: SendcloudEnv,
  query: { orderNumber?: string; parcelIds?: number[]; pageSize?: number } = {},
): Promise<{ ok: true; shipments: SendcloudShipment[] } | { ok: false; error: string }> {
  const qs = new URLSearchParams();
  if (query.orderNumber?.trim()) qs.set("order_number", query.orderNumber.trim());
  if (query.parcelIds?.length) qs.set("ids", query.parcelIds.slice(0, 100).join(","));
  if (query.pageSize) qs.set("page_size", String(Math.min(100, Math.max(1, query.pageSize))));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await sendcloudPanelV3Fetch<{ data: SendcloudShipment[] }>(
    env,
    `/shipments${suffix}`,
    { method: "GET" },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, shipments: res.data.data ?? [] };
}

export function buildOutboundShipmentAnnounceBody(input: {
  orderNumber: string;
  shippingOptionCode: string;
  recipient: SendcloudOutboundRecipient;
  servicePointId: number;
  senderAddressId?: number | null;
  itemCount?: number;
  parcelWeightKg?: string;
}): Record<string, unknown> {
  const weightValue =
    input.parcelWeightKg?.trim() ||
    (input.itemCount != null ? formatSendcloudParcelWeightKg(input.itemCount) : "1.0");

  const body: Record<string, unknown> = {
    label_details: { mime_type: "application/pdf", dpi: 72 },
    order_number: input.orderNumber,
    total_order_price: { currency: "EUR", value: "1.00" },
    to_address: buildSendcloudAddressNode(input.recipient),
    ship_with: {
      type: "shipping_option_code",
      properties: { shipping_option_code: input.shippingOptionCode.trim() },
    },
    to_service_point: { id: String(input.servicePointId) },
    parcels: [
      {
        weight: { value: weightValue, unit: "kg" },
        dimensions: { length: "30", width: "20", height: "10", unit: "cm" },
      },
    ],
  };

  if (input.senderAddressId) {
    body.from_address = { sender_address_id: input.senderAddressId };
  }

  return body;
}

/** Retour membre → point relais hub Segna (checkout `return_relay_code`). */
export function buildReturnShipmentAnnounceBody(input: {
  orderNumber: string;
  shippingOptionCode: string;
  shipper: SendcloudOutboundRecipient;
  hubRecipient: SendcloudOutboundRecipient;
  hubServicePointId: number;
  hubPostNumber?: string | null;
  itemCount?: number;
  parcelWeightKg?: string;
}): Record<string, unknown> {
  const weightValue =
    input.parcelWeightKg?.trim() ||
    (input.itemCount != null ? formatSendcloudParcelWeightKg(input.itemCount) : "1.0");
  const toServicePoint: Record<string, string> = { id: String(input.hubServicePointId) };
  const post = input.hubPostNumber?.trim();
  if (post) toServicePoint.post_number = post.slice(0, 40);

  return {
    label_details: { mime_type: "application/pdf", dpi: 72 },
    order_number: input.orderNumber,
    total_order_price: { currency: "EUR", value: "1.00" },
    from_address: buildSendcloudAddressNode(input.shipper),
    to_address: buildSendcloudAddressNode(input.hubRecipient),
    to_service_point: toServicePoint,
    ship_with: {
      type: "shipping_option_code",
      properties: { shipping_option_code: input.shippingOptionCode.trim() },
    },
    parcels: [
      {
        weight: { value: weightValue, unit: "kg" },
        dimensions: { length: "30", width: "20", height: "10", unit: "cm" },
      },
    ],
  };
}

export async function announceSendcloudShipmentSync(
  env: SendcloudEnv,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; parcel: SendcloudShipmentParcel; labelUrl: string }
  | { ok: false; error: string }
> {
  const res = await sendcloudPanelV3Fetch<{ data: SendcloudShipment }>(env, "/shipments/announce", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: res.error };

  const parcel = res.data.data.parcels?.[0];
  if (!parcel?.id) {
    return { ok: false, error: "Sendcloud : annonce sans colis." };
  }
  if (isSendcloudParcelCancelled(parcel)) {
    return { ok: false, error: "Sendcloud : colis annulé à la création." };
  }

  const labelUrl = resolveParcelLabelUrl(env, parcel);
  if (!labelUrl) return { ok: false, error: "Sendcloud : étiquette absente." };

  return { ok: true, parcel, labelUrl };
}

export async function fetchSendcloudParcelV3(
  env: SendcloudEnv,
  parcelId: number,
): Promise<SendcloudShipmentParcel | null> {
  const listed = await listSendcloudShipments(env, { parcelIds: [parcelId], pageSize: 10 });
  if (!listed.ok) return null;

  for (const shipment of listed.shipments) {
    const parcel = shipment.parcels?.find((p) => p.id === parcelId);
    if (parcel) return parcel;
  }
  return null;
}

/** Tous les colis Sendcloud v3 rattachés à un `order_number` (plusieurs expéditions possibles). */
export async function findSendcloudParcelsByOrderNumberV3(
  env: SendcloudEnv,
  orderNumber: string,
): Promise<SendcloudShipmentParcel[]> {
  const on = orderNumber.trim();
  if (!on) return [];

  const listed = await listSendcloudShipments(env, { orderNumber: on, pageSize: 40 });
  if (!listed.ok) return [];

  const parcels: SendcloudShipmentParcel[] = [];
  for (const shipment of listed.shipments) {
    for (const parcel of shipment.parcels ?? []) {
      parcels.push({ ...parcel, tracking_number: parcel.tracking_number ?? undefined });
    }
  }
  return parcels;
}

/** Identifiants d’expédition v3 pour un `order_number`. */
export async function findSendcloudShipmentIdsByOrderNumber(
  env: SendcloudEnv,
  orderNumber: string,
): Promise<string[]> {
  const on = orderNumber.trim();
  if (!on) return [];

  const listed = await listSendcloudShipments(env, { orderNumber: on, pageSize: 40 });
  if (!listed.ok) return [];

  const ids: string[] = [];
  for (const shipment of listed.shipments) {
    const id = String(shipment.id ?? "").trim();
    if (id) ids.push(id);
  }
  return ids;
}
