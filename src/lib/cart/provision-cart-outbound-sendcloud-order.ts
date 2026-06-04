import type { SupabaseClient } from "@supabase/supabase-js";

import { checkoutMetaIndicatesUberDirect } from "@/lib/cart/cart-outbound-delivery-kind";
import { readSendcloudOutboundMetaFromRecord } from "@/lib/cart/checkout-sendcloud-outbound-option";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/normalize-french-e164";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import {
  fetchSendcloudDeliveryOptions,
  findSendcloudDeliveryOptionByCode,
  pickSendcloudDeliveryOption,
} from "@/lib/sendcloud/dynamic-checkout";
import { resolveSendcloudIntegrationId } from "@/lib/sendcloud/integrations";
import {
  buildSegnaSendcloudOrderRowForProvision,
  findSendcloudOrderByNumber,
  upsertSendcloudOrders,
} from "@/lib/sendcloud/orders-api";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";
import type { SendcloudOutboundRecipient } from "@/lib/sendcloud/shipments";
import { resolveRelayShippingOptionCode } from "@/lib/sendcloud/shipping-options";
import { resolveSendcloudServicePointId } from "@/lib/sendcloud/service-points";
import { persistCartSendcloudOutboundRef } from "@/lib/cart/persist-cart-sendcloud-outbound-ref";
import {
  buildSendcloudOrderItemsFromLines,
  mapCartItemJoinToSendcloudOrderInput,
} from "@/lib/sendcloud/build-sendcloud-order-items";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";

export type ProvisionCartOutboundSendcloudOrderResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; orderNumber: string; sendcloudPanelOrderId: string | null }
  | { ok: false; error: string };

function isHomeDestination(dest: Record<string, unknown> | null): boolean {
  if (!dest) return false;
  const t = String(dest.destination_type ?? "").toLowerCase();
  return t === "home" || t.includes("domicile");
}

function recipientFromUser(
  user: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    adress: string | null;
  },
  parsedOverride?: ReturnType<typeof parseMemberAdressForShipment>,
): SendcloudOutboundRecipient | { error: string } {
  const fn = (user.first_name ?? "Membre").trim() || "Membre";
  const ln = (user.last_name ?? "Segna").trim() || "Segna";
  const email = (user.email ?? "noreply@segna.invalid").trim();
  const phone = normalizeFrenchPhoneToE164(String(user.phone ?? "")) || "+33600000000";
  const parsed = parsedOverride ?? parseMemberAdressForShipment(user.adress);
  if (!parsed?.sender_postcode || !parsed.sender_city || !parsed.sender_street) {
    return { error: "Adresse membre incomplète pour Sendcloud." };
  }
  return {
    name: `${fn} ${ln}`.trim().slice(0, 64),
    addressLine1: parsed.sender_street.slice(0, 64),
    houseNumber: parsed.sender_houseno?.trim().slice(0, 16) || "1",
    postalCode: parsed.sender_postcode.replace(/\D/g, "").slice(0, 5),
    city: parsed.sender_city.slice(0, 64),
    countryCode: (parsed.sender_country || "FR").toUpperCase().slice(0, 2),
    phone: phone.slice(0, 32),
    email: email.slice(0, 128),
  };
}

async function resolveShippingOptionCode(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  params: {
    channel: "relay" | "home";
    optionCode: string;
    postalCode: string;
    itemCount: number;
    orderValueEur: number;
  },
): Promise<string | null> {
  const code = params.optionCode.trim();
  if (code) return code;

  const explicitHome = process.env.SENDCLOUD_SHIPPING_OPTION_HOME?.trim();
  if (params.channel === "home" && explicitHome) return explicitHome;

  const pc = params.postalCode.replace(/\D/g, "").slice(0, 5);
  if (env.checkoutConfigurationId && pc.length === 5) {
    const { options } = await fetchSendcloudDeliveryOptions(env, {
      toPostalCode: pc,
      toCountry: "FR",
      weightGrams: exchangeShippingWeightGrams(params.itemCount),
      orderValueEur: params.orderValueEur,
    });
    const found = findSendcloudDeliveryOptionByCode(options, params.channel, code);
    if (found?.checkoutIdentifierValue) return found.checkoutIdentifierValue;
    const picked = pickSendcloudDeliveryOption(options, params.channel);
    if (picked?.checkoutIdentifierValue) return picked.checkoutIdentifierValue;
  }

  if (env.relayShippingOptionCode) return env.relayShippingOptionCode;
  if (env.relayShippingMethodId) {
    return resolveRelayShippingOptionCode(env, env.relayShippingMethodId);
  }
  return null;
}

async function mergeDestinationSendcloudProvisionMeta(
  admin: SupabaseClient,
  shipmentId: string,
  patch: Record<string, unknown>,
  cartId?: string,
): Promise<void> {
  const { data: dest } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", shipmentId)
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

  const orderNumber =
    typeof patch.sendcloud_order_number === "string" ? patch.sendcloud_order_number.trim() : "";
  if (cartId && orderNumber) {
    const panelRaw = patch.sendcloud_panel_order_id;
    const panelOrderId =
      panelRaw === null || panelRaw === undefined
        ? undefined
        : String(panelRaw).trim() || null;
    await persistCartSendcloudOutboundRef(admin, cartId, {
      orderNumber,
      panelOrderId,
      clearCancelledAt: true,
    });
  }
}

/**
 * Crée la commande Sendcloud (sans étiquette) dès confirmation panier — visible dans « Commandes importées ».
 * Ne bloque pas le paiement en cas d’échec (journalisation uniquement).
 */
export async function provisionCartOutboundSendcloudOrder(
  admin: SupabaseClient,
  params: {
    cartId: string;
    deliveryChannel?: "relay" | "home";
    homeSpeed?: string | null;
    /** Ignore `sendcloud_order_provisioned_at` (recréation BO). */
    force?: boolean;
    /** Numéro de commande Sendcloud (`buildSendcloudOrderNumber`). */
    generation?: number;
  },
): Promise<ProvisionCartOutboundSendcloudOrderResult> {
  const env = getSendcloudEnv();
  if (!env) {
    return { ok: true, skipped: true, reason: "sendcloud_not_configured" };
  }

  const deliveryChannel = params.deliveryChannel ?? "relay";
  const homeSpeed = params.homeSpeed ?? null;
  if (checkoutMetaIndicatesUberDirect(deliveryChannel, homeSpeed)) {
    return { ok: true, skipped: true, reason: "uber_direct" };
  }

  const { data: ship, error: shipErr } = await admin
    .from("shipments")
    .select("id, cart_id")
    .eq("cart_id", params.cartId.trim())
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shipErr || !ship?.id) {
    return { ok: true, skipped: true, reason: "no_outbound_shipment" };
  }

  const shipmentId = String(ship.id);

  const { data: destRow } = await admin
    .from("shipment_destinations")
    .select("destination_type, provider_point_id, line1, postal_code, city, metadata")
    .eq("shipment_id", shipmentId)
    .limit(1)
    .maybeSingle();

  const dest = destRow as Record<string, unknown> | null;
  const destMeta =
    dest?.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};
  const generation = Math.max(
    1,
    Math.trunc(
      params.generation ??
        ((typeof destMeta.sendcloud_label_generation === "number"
          ? destMeta.sendcloud_label_generation
          : Number(destMeta.sendcloud_label_generation)) ||
          1),
    ),
  );

  if (destMeta.sendcloud_order_provisioned_at && !params.force) {
    const existingOrderNumber = String(destMeta.sendcloud_order_number ?? "").trim();
    if (existingOrderNumber) {
      await persistCartSendcloudOutboundRef(admin, params.cartId, {
        orderNumber: existingOrderNumber,
        panelOrderId: String(destMeta.sendcloud_panel_order_id ?? "").trim() || null,
        clearCancelledAt: !destMeta.sendcloud_order_cancelled_at,
      });
    }
    return {
      ok: true,
      skipped: true,
      reason: "already_provisioned",
    };
  }

  const checkoutMeta = readSendcloudOutboundMetaFromRecord(destMeta);
  if (!checkoutMeta?.sendcloud_outbound_option_code) {
    return { ok: true, skipped: true, reason: "no_sendcloud_outbound_option" };
  }

  const { data: cartRow } = await admin
    .from("carts")
    .select("user_id")
    .eq("id", params.cartId)
    .maybeSingle();

  const userId = (cartRow as { user_id?: string } | null)?.user_id;
  if (!userId) {
    return { ok: false, error: "cart_user_missing" };
  }

  const { data: user } = await admin
    .from("users")
    .select("first_name, last_name, email, phone, adress")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return { ok: false, error: "user_missing" };
  }

  const { data: cartItemRows, count: itemCount } = await admin
    .from("cart_items")
    .select(
      "id, item_id, items(id, title, price_points, item_custom_brand_label, item_brands(label))",
      { count: "exact" },
    )
    .eq("cart_id", params.cartId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const packLines = Math.max(1, itemCount ?? cartItemRows?.length ?? 1);
  const orderItemLines = (cartItemRows ?? []).map((row) =>
    mapCartItemJoinToSendcloudOrderInput(row as Parameters<typeof mapCartItemJoinToSendcloudOrderInput>[0]),
  );
  const { totalValueEur: orderDeclaredValueEur } = buildSendcloudOrderItemsFromLines(orderItemLines);
  const deliveryHome = isHomeDestination(dest) || deliveryChannel === "home";

  let parsedDelivery: ReturnType<typeof parseMemberAdressForShipment> = null;
  const line1 = typeof dest?.line1 === "string" ? dest.line1.trim() : "";
  if (line1) parsedDelivery = parseMemberAdressForShipment(line1);
  const destPostal =
    typeof dest?.postal_code === "string" ? dest.postal_code.replace(/\D/g, "").slice(0, 5) : "";
  const destCity = typeof dest?.city === "string" ? dest.city.trim() : "";
  if (parsedDelivery && destPostal.length === 5) {
    parsedDelivery = {
      ...parsedDelivery,
      sender_postcode: destPostal,
      sender_city: destCity || parsedDelivery.sender_city,
    };
  }

  const recipient = recipientFromUser(
    user as {
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      adress: string | null;
    },
    parsedDelivery ?? undefined,
  );
  if ("error" in recipient) {
    return { ok: false, error: recipient.error };
  }

  const shippingOptionCode = await resolveShippingOptionCode(env, {
    channel: deliveryHome ? "home" : "relay",
    optionCode: checkoutMeta.sendcloud_outbound_option_code,
    postalCode: recipient.postalCode,
    itemCount: packLines,
    orderValueEur: orderDeclaredValueEur,
  });
  if (!shippingOptionCode) {
    return { ok: false, error: "sendcloud_shipping_option_unresolved" };
  }

  let servicePointId: number | null = null;
  let toPostNumber: string | null = null;

  if (!deliveryHome) {
    const relayCode = typeof dest?.provider_point_id === "string" ? dest.provider_point_id.trim() : "";
    if (!relayCode) {
      return { ok: true, skipped: true, reason: "no_relay_point" };
    }
    const resolved = await resolveSendcloudServicePointId(env, {
      relayCode,
      country: recipient.countryCode,
      postalCode: recipient.postalCode,
    });
    if ("error" in resolved) {
      return { ok: false, error: resolved.error };
    }
    servicePointId = resolved.id;
    toPostNumber = resolved.postNumber;
  }

  const integrationId = await resolveSendcloudIntegrationId(env);
  if (!integrationId) {
    return { ok: false, error: "sendcloud_integration_id_missing" };
  }

  const orderNumber = buildSendcloudOrderNumber({
    cartId: params.cartId,
    shipmentId,
    generation,
  });

  const existing = await findSendcloudOrderByNumber(env, orderNumber, integrationId);
  if (existing) {
    const panelId = String(existing.id ?? "").trim() || null;
    await mergeDestinationSendcloudProvisionMeta(
      admin,
      shipmentId,
      {
        sendcloud_order_number: orderNumber,
        sendcloud_panel_order_id: panelId,
        sendcloud_order_provisioned_at: new Date().toISOString(),
        sendcloud_label_generation: generation,
        sendcloud_order_cancelled_at: null,
      },
      params.cartId,
    );
    return { ok: true, orderNumber, sendcloudPanelOrderId: panelId };
  }

  const upsert = await upsertSendcloudOrders(env, [
    buildSegnaSendcloudOrderRowForProvision({
      orderId: shipmentId,
      orderNumber,
      integrationId,
      shippingOptionCode,
      recipient,
      servicePointId,
      toPostNumber,
      orderItemLines,
    }),
  ]);

  if (!upsert.ok) {
    console.error("[cart-order] sendcloud order provision failed", upsert.error);
    return { ok: false, error: upsert.error };
  }

  const created = upsert.orders[0];
  const panelId =
    String(created?.id ?? "").trim() ||
    (await findSendcloudOrderByNumber(env, orderNumber, integrationId))?.id?.toString() ||
    null;

  await mergeDestinationSendcloudProvisionMeta(
    admin,
    shipmentId,
    {
      sendcloud_order_number: orderNumber,
      sendcloud_panel_order_id: panelId,
      sendcloud_order_provisioned_at: new Date().toISOString(),
      sendcloud_label_generation: generation,
      sendcloud_order_cancelled_at: null,
    },
    params.cartId,
  );

  console.info("[cart-order] sendcloud order provisioned", {
    cartId: params.cartId,
    orderNumber,
    sendcloudPanelOrderId: panelId,
  });

  return { ok: true, orderNumber, sendcloudPanelOrderId: panelId };
}
