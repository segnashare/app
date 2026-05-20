import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { resolveSendcloudIntegrationId, resolveSendcloudSenderAddressId } from "@/lib/sendcloud/integrations";
import { waitForSendcloudParcelLabel } from "@/lib/sendcloud/label-url";
import type { SendcloudOrderItemInput } from "@/lib/sendcloud/build-sendcloud-order-items";
import {
  buildSegnaSendcloudOrderRow,
  createSendcloudOrderLabelSync,
  createSendcloudOrderLabelsAsync,
  findSendcloudOrderByNumber,
  upsertSendcloudOrders,
} from "@/lib/sendcloud/orders-api";
import { pickDefaultRelayShippingMethodId, resolveRelayShippingOptionCode } from "@/lib/sendcloud/shipping-options";
import {
  announceSendcloudShipmentSync,
  buildOutboundShipmentAnnounceBody,
} from "@/lib/sendcloud/shipments";

export type CreateSendcloudRelayLabelInput = {
  orderId: string;
  orderNumber: string;
  /** Nombre de pièces panier — détermine la tranche poids Sendcloud (1–3 → 0,75 kg, 4+ → 1,5 kg). */
  itemCount?: number;
  /** Détail des pièces pour la commande importée Sendcloud (1 ligne = 1 article). */
  orderItemLines?: SendcloudOrderItemInput[];
  servicePointId: number;
  recipient: {
    name: string;
    addressLine1: string;
    houseNumber: string;
    postalCode: string;
    city: string;
    countryCode: string;
    phone: string;
    email: string;
  };
  shippingOptionCode?: string | null;
};

export type CreateSendcloudRelayLabelResult =
  | {
      ok: true;
      parcelId: number;
      trackingNumber: string;
      labelUrl: string;
      orderNumber: string;
    }
  | { ok: false; error: string };

async function upsertSendcloudOrderIfMissing(
  env: SendcloudEnv,
  integrationId: number,
  input: CreateSendcloudRelayLabelInput,
  shippingOptionCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await findSendcloudOrderByNumber(env, input.orderNumber, integrationId);
  if (existing) return { ok: true };

  const upsert = await upsertSendcloudOrders(env, [
    buildSegnaSendcloudOrderRow({
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      integrationId,
      shippingOptionCode,
      recipient: input.recipient,
      servicePointId: input.servicePointId,
      orderItemLines: input.orderItemLines,
    }),
  ]);
  if (!upsert.ok) return { ok: false, error: upsert.error };
  return { ok: true };
}

async function createSendcloudRelayOutboundLabelViaOrderSync(
  env: SendcloudEnv,
  input: CreateSendcloudRelayLabelInput,
  integrationId: number,
  shippingOptionCode: string,
  senderAddressId: number | null,
): Promise<CreateSendcloudRelayLabelResult> {
  const ensured = await upsertSendcloudOrderIfMissing(env, integrationId, input, shippingOptionCode);
  if (!ensured.ok) return { ok: false, error: ensured.error };

  const sync = await createSendcloudOrderLabelSync(env, {
    integration_id: integrationId,
    order: { order_number: input.orderNumber, apply_shipping_rules: false },
    sender_address_id: senderAddressId ?? undefined,
    ship_with: {
      type: "shipping_option_code",
      properties: { shipping_option_code: shippingOptionCode },
    },
  });
  if (!sync.ok) return { ok: false, error: sync.error };

  return {
    ok: true,
    parcelId: sync.parcelId,
    trackingNumber: sync.trackingNumber,
    labelUrl: sync.labelUrl,
    orderNumber: input.orderNumber,
  };
}

async function createSendcloudRelayOutboundLabelLegacy(
  env: SendcloudEnv,
  input: CreateSendcloudRelayLabelInput,
  integrationId: number,
  shippingOptionCode: string,
  senderAddressId: number | null,
): Promise<CreateSendcloudRelayLabelResult> {
  const ensured = await upsertSendcloudOrderIfMissing(env, integrationId, input, shippingOptionCode);
  if (!ensured.ok) return { ok: false, error: ensured.error };

  const labels = await createSendcloudOrderLabelsAsync(env, {
    integration_id: integrationId,
    orders: [{ order_number: input.orderNumber, apply_shipping_rules: false }],
    sender_address_id: senderAddressId ?? undefined,
  });
  if (!labels.ok) return { ok: false, error: labels.error };

  const labelReady = await waitForSendcloudParcelLabel(env, labels.parcelId);
  if (!labelReady.ok) return { ok: false, error: labelReady.error };

  return {
    ok: true,
    parcelId: labels.parcelId,
    trackingNumber: labelReady.trackingNumber,
    labelUrl: labelReady.labelUrl,
    orderNumber: input.orderNumber,
  };
}

export async function createSendcloudRelayOutboundLabel(
  env: SendcloudEnv,
  input: CreateSendcloudRelayLabelInput,
): Promise<CreateSendcloudRelayLabelResult> {
  const integrationId = await resolveSendcloudIntegrationId(env);
  if (!integrationId) {
    return { ok: false, error: "Sendcloud : integration_id introuvable (SENDCLOUD_INTEGRATION_ID ou /integrations)." };
  }

  const methodId = await pickDefaultRelayShippingMethodId(env);
  let shippingOptionCode = input.shippingOptionCode ?? env.relayShippingOptionCode;
  if (!shippingOptionCode && methodId) {
    shippingOptionCode = await resolveRelayShippingOptionCode(env, methodId);
  }
  if (!shippingOptionCode) {
    return {
      ok: false,
      error:
        "Sendcloud : définir SENDCLOUD_SHIPPING_OPTION_RELAY ou SENDCLOUD_SHIPPING_METHOD_RELAY_ID (ex. 28037).",
    };
  }

  const senderAddressId = await resolveSendcloudSenderAddressId(env);

  const shipmentBody = buildOutboundShipmentAnnounceBody({
    orderNumber: input.orderNumber,
    shippingOptionCode,
    recipient: input.recipient,
    servicePointId: input.servicePointId,
    senderAddressId,
    itemCount: input.itemCount,
  });

  const announced = await announceSendcloudShipmentSync(env, shipmentBody);
  if (announced.ok) {
    return {
      ok: true,
      parcelId: announced.parcel.id,
      trackingNumber: String(announced.parcel.tracking_number ?? "").trim(),
      labelUrl: announced.labelUrl,
      orderNumber: input.orderNumber,
    };
  }

  if (process.env.SENDCLOUD_SHIPMENTS_V3_ONLY === "1") {
    return { ok: false, error: announced.error };
  }

  const viaSync = await createSendcloudRelayOutboundLabelViaOrderSync(
    env,
    input,
    integrationId,
    shippingOptionCode,
    senderAddressId,
  );
  if (viaSync.ok) return viaSync;

  return createSendcloudRelayOutboundLabelLegacy(
    env,
    input,
    integrationId,
    shippingOptionCode,
    senderAddressId,
  );
}
