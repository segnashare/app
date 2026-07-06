import type { SupabaseClient } from "@supabase/supabase-js";

import { shouldSkipSendcloudReturnForLegacyUberMr } from "@/lib/cart/coursier-checkout-meta";
import {
  ensureCartReturnShipmentForPortal,
  isCartReturnProvisionedForCart,
  isCartReturnSendcloudOrderProvisioned,
} from "@/lib/cart/cart-return-shipment";
import { readCheckoutReturnRelayFromOutboundMetadata } from "@/lib/cart/checkout-return-relay-meta";
import { getSegnaRecipientFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { resolveSendcloudIntegrationId } from "@/lib/sendcloud/integrations";
import {
  buildSegnaSendcloudOrderRowForProvision,
  findSendcloudOrderByNumber,
  upsertSendcloudOrders,
} from "@/lib/sendcloud/orders-api";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";
import { loadReturnShippingOutboundContextForCart } from "@/lib/sendcloud/resolve-return-shipping-outbound-context";
import { resolveReturnHubSendcloudServicePoint } from "@/lib/sendcloud/resolve-return-hub-sendcloud-service-point";
import { resolveReturnShippingOptionCode } from "@/lib/sendcloud/resolve-return-shipping-option";
import type { SendcloudOutboundRecipient } from "@/lib/sendcloud/shipments";
import {
  buildSendcloudOrderItemsFromLines,
  mapCartItemJoinToSendcloudOrderInput,
} from "@/lib/sendcloud/build-sendcloud-order-items";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";

export type ProvisionCartReturnSendcloudOrderResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; orderNumber: string; returnShipmentId: string; sendcloudPanelOrderId: string | null }
  | { ok: false; error: string };

function hubRecipientFromEnv(): SendcloudOutboundRecipient | { error: string } {
  const hub = getSegnaRecipientFromEnv();
  if (!hub) return { error: "hub_segna_incomplete" };
  const phone = normalizeFrenchPhoneToE164(hub.MobileNo) || "+33600000000";
  return {
    name: `${hub.Firstname} ${hub.Lastname}`.trim().slice(0, 64),
    addressLine1: hub.Streetname.trim().slice(0, 64),
    houseNumber: hub.HouseNo.trim().slice(0, 16) || "1",
    postalCode: hub.PostCode.replace(/\D/g, "").slice(0, 5),
    city: hub.City.trim().slice(0, 64),
    countryCode: (hub.CountryCode?.trim().toUpperCase() || "FR").slice(0, 2),
    phone: phone.slice(0, 32),
    email: hub.Email.trim().slice(0, 128),
  };
}

async function mergeReturnProvisionMeta(
  admin: SupabaseClient,
  returnShipmentId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data: dest } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", returnShipmentId)
    .limit(1)
    .maybeSingle();
  const row = dest as { id?: string; metadata?: Record<string, unknown> } | null;
  if (!row?.id) return;
  const prev =
    row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  await admin
    .from("shipment_destinations")
    .update({ metadata: { ...prev, ...patch } })
    .eq("id", row.id);
}

async function readReturnGeneration(
  admin: SupabaseClient,
  returnShipmentId: string,
  fallback: number,
): Promise<number> {
  const { data: dest } = await admin
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", returnShipmentId)
    .limit(1)
    .maybeSingle();
  const meta = (dest as { metadata?: Record<string, unknown> } | null)?.metadata;
  const raw = meta?.sendcloud_label_generation;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

const PROVISION_LOCK_MS = 90_000;

async function claimCartReturnProvisionLock(
  admin: SupabaseClient,
  returnShipmentId: string,
): Promise<{ claimed: boolean; reason?: string }> {
  const { data: dest } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", returnShipmentId)
    .limit(1)
    .maybeSingle();
  const row = dest as { id?: string; metadata?: Record<string, unknown> } | null;
  if (!row?.id) return { claimed: true };

  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (isCartReturnSendcloudOrderProvisioned(meta)) {
    return { claimed: false, reason: "already_provisioned" };
  }

  const lockAt = String(meta.sc_cart_return_provision_lock_at ?? "").trim();
  if (lockAt && Date.now() - Date.parse(lockAt) < PROVISION_LOCK_MS) {
    return { claimed: false, reason: "provision_in_progress" };
  }

  const now = new Date().toISOString();
  await admin
    .from("shipment_destinations")
    .update({ metadata: { ...meta, sc_cart_return_provision_lock_at: now } })
    .eq("id", row.id);
  return { claimed: true };
}

async function releaseCartReturnProvisionLock(
  admin: SupabaseClient,
  returnShipmentId: string,
): Promise<void> {
  const { data: dest } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", returnShipmentId)
    .limit(1)
    .maybeSingle();
  const row = dest as { id?: string; metadata?: Record<string, unknown> } | null;
  if (!row?.id) return;
  const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  delete meta.sc_cart_return_provision_lock_at;
  await admin.from("shipment_destinations").update({ metadata: meta }).eq("id", row.id);
}

/**
 * Commande Sendcloud retour (importée, sans étiquette) dès confirmation panier.
 */
export async function provisionCartReturnSendcloudOrder(
  admin: SupabaseClient,
  params: {
    cartId: string;
    deliveryChannel?: "relay" | "home";
    homeSpeed?: string | null;
    force?: boolean;
    generation?: number;
  },
): Promise<ProvisionCartReturnSendcloudOrderResult> {
  const env = getSendcloudEnv();
  if (!env) return { ok: true, skipped: true, reason: "sendcloud_not_configured" };

  const deliveryChannel = params.deliveryChannel ?? "relay";
  if (
    shouldSkipSendcloudReturnForLegacyUberMr({
      deliveryChannel,
      homeSpeed: params.homeSpeed ?? null,
    })
  ) {
    return { ok: true, skipped: true, reason: "uber_direct" };
  }

  const cartId = params.cartId.trim();

  if (!params.force && (await isCartReturnProvisionedForCart(admin, cartId))) {
    return { ok: true, skipped: true, reason: "already_provisioned" };
  }

  const { data: outShip } = await admin
    .from("shipments")
    .select(
      "id, tracking_number, member_tracking_url, provider_id, shipment_destinations ( destination_type, provider_point_id, line1, metadata ), shipment_providers ( code )",
    )
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!outShip?.id) return { ok: true, skipped: true, reason: "no_outbound_shipment" };

  const outboundShipmentId = String(outShip.id);

  const destEmb = (outShip as { shipment_destinations?: unknown }).shipment_destinations;
  const destRows = Array.isArray(destEmb) ? destEmb : destEmb ? [destEmb] : [];
  const outDest = (destRows[0] ?? null) as { metadata?: Record<string, unknown> } | null;
  const returnRelayMeta = readCheckoutReturnRelayFromOutboundMetadata(outDest?.metadata);

  const hubResolved = await resolveReturnHubSendcloudServicePoint(env, { returnRelayMeta });
  if ("error" in hubResolved) {
    if (hubResolved.error === "no_return_hub") {
      return { ok: true, skipped: true, reason: "no_return_hub" };
    }
    return { ok: false, error: hubResolved.error };
  }

  const ensured = await ensureCartReturnShipmentForPortal(admin, cartId, "", {
    assignSendcloudProvider: false,
  });
  if (!ensured.ok) return { ok: false, error: ensured.error };
  const returnShipmentId = ensured.shipmentId;

  const generation = Math.max(
    1,
    params.generation ??
      (await readReturnGeneration(admin, returnShipmentId, 1)),
  );

  if (!params.force) {
    const claim = await claimCartReturnProvisionLock(admin, returnShipmentId);
    if (!claim.claimed) {
      return { ok: true, skipped: true, reason: claim.reason ?? "provision_in_progress" };
    }
  }

  const { data: cartItemRows, count: itemCount } = await admin
    .from("cart_items")
    .select(
      "id, item_id, items(id, title, price_points, item_custom_brand_label, item_brands(label))",
      { count: "exact" },
    )
    .eq("cart_id", cartId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const packLines = Math.max(1, itemCount ?? cartItemRows?.length ?? 1);
  const orderItemLines = (cartItemRows ?? []).map((row) =>
    mapCartItemJoinToSendcloudOrderInput(row as Parameters<typeof mapCartItemJoinToSendcloudOrderInput>[0]),
  );
  buildSendcloudOrderItemsFromLines(orderItemLines);

  const returnCtx = await loadReturnShippingOutboundContextForCart(
    admin,
    cartId,
    hubResolved.postalCode,
    packLines,
  );

  const shippingResolved = await resolveReturnShippingOptionCode(env, returnCtx);
  if (!shippingResolved.ok) {
    if (!params.force) await releaseCartReturnProvisionLock(admin, returnShipmentId);
    return { ok: false, error: shippingResolved.error };
  }

  const hubContact = hubRecipientFromEnv();
  if ("error" in hubContact) return { ok: false, error: hubContact.error };

  const street = hubResolved.street.trim() || hubContact.addressLine1;
  const hubRecipient: SendcloudOutboundRecipient = {
    ...hubContact,
    addressLine1: street.slice(0, 64),
    postalCode: hubResolved.postalCode.replace(/\D/g, "").slice(0, 5) || hubContact.postalCode,
    city: (hubResolved.city.trim() || hubContact.city).slice(0, 64),
  };

  const integrationId = await resolveSendcloudIntegrationId(env);
  if (!integrationId) return { ok: false, error: "sendcloud_integration_id_missing" };

  const orderNumber = buildSendcloudOrderNumber({
    cartId,
    shipmentId: returnShipmentId,
    generation,
  });

  const existing = await findSendcloudOrderByNumber(env, orderNumber, integrationId);
  if (existing) {
    const panelId = String(existing.id ?? "").trim() || null;
    await admin.rpc("set_shipment_provider", {
      p_shipment_id: returnShipmentId,
      p_provider_code: "sendcloud",
    });
    await mergeReturnProvisionMeta(admin, returnShipmentId, {
      sendcloud_order_number: orderNumber,
      sendcloud_panel_order_id: panelId,
      sendcloud_order_provisioned_at: new Date().toISOString(),
      sendcloud_label_generation: generation,
      sendcloud_order_cancelled_at: null,
      sc_cart_return_provisioned_at: new Date().toISOString(),
    });
    return { ok: true, orderNumber, returnShipmentId, sendcloudPanelOrderId: panelId };
  }

  const upsert = await upsertSendcloudOrders(env, [
    buildSegnaSendcloudOrderRowForProvision({
      orderId: returnShipmentId,
      orderNumber,
      integrationId,
      shippingOptionCode: shippingResolved.code,
      recipient: hubRecipient,
      servicePointId: hubResolved.id,
      toPostNumber: hubResolved.postNumber,
      orderItemLines,
    }),
  ]);

  if (!upsert.ok) {
    if (!params.force) await releaseCartReturnProvisionLock(admin, returnShipmentId);
    console.error("[cart-order] sendcloud return order provision failed", upsert.error);
    return { ok: false, error: upsert.error };
  }

  const created = upsert.orders[0];
  const panelId =
    String(created?.id ?? "").trim() ||
    (await findSendcloudOrderByNumber(env, orderNumber, integrationId))?.id?.toString() ||
    null;

  await admin.rpc("set_shipment_provider", {
    p_shipment_id: returnShipmentId,
    p_provider_code: "sendcloud",
  });

  await mergeReturnProvisionMeta(admin, returnShipmentId, {
    sendcloud_order_number: orderNumber,
    sendcloud_panel_order_id: panelId,
    sendcloud_order_provisioned_at: new Date().toISOString(),
    sendcloud_label_generation: generation,
    sendcloud_order_cancelled_at: null,
    sc_cart_return_provisioned_at: new Date().toISOString(),
    sc_return_shipping_strategy: shippingResolved.strategy,
  });

  console.info("[cart-order] sendcloud return order provisioned", {
    cartId,
    orderNumber,
    returnShipmentId,
    strategy: shippingResolved.strategy,
  });

  return { ok: true, orderNumber, returnShipmentId, sendcloudPanelOrderId: panelId };
}
