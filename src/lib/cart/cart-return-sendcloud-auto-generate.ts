import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readCheckoutReturnRelayFromOutboundMetadata,
  type CheckoutReturnRelayMeta,
} from "@/lib/cart/checkout-return-relay-meta";
import { isCartReturnLockedForMemberSetup, normalizeCartReturnShipmentStatus } from "@/lib/cart/cart-return-status";
import { getSegnaRecipientFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";
import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import {
  fetchSendcloudDeliveryOptions,
  pickSendcloudDeliveryOption,
} from "@/lib/sendcloud/dynamic-checkout";
import { resolveSendcloudIntegrationId } from "@/lib/sendcloud/integrations";
import { getSegnaLogisticsHubFromEnv } from "@/lib/sendcloud/logistics-hub";
import { exchangeShippingWeightGrams } from "@/lib/shipping/exchange-shipping-pricing";
import { mapCartItemJoinToSendcloudOrderInput } from "@/lib/sendcloud/build-sendcloud-order-items";
import {
  buildSegnaSendcloudOrderRow,
  createSendcloudOrderLabelSync,
  upsertSendcloudOrders,
} from "@/lib/sendcloud/orders-api";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";
import { resolveDefaultCheckoutReturnRelayHub } from "@/lib/sendcloud/resolve-checkout-return-relay-hub";
import {
  resolveSendcloudServicePointId,
  type ResolvedSendcloudServicePoint,
} from "@/lib/sendcloud/service-points";
import {
  announceSendcloudShipmentSync,
  buildReturnShipmentAnnounceBody,
  type SendcloudOutboundRecipient,
} from "@/lib/sendcloud/shipments";
import { resolveRelayShippingOptionCode } from "@/lib/sendcloud/shipping-options";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CartReturnSendcloudAutoResult =
  | { ok: true; shipment_id: string; label_url: string; numero_suivi: string | null; reused?: boolean }
  | { ok: false; error: string; status: number; developer_hint?: string };

async function resolveReturnHubRelayTarget(
  meta: CheckoutReturnRelayMeta,
): Promise<
  | { ok: true; relayCode: string; postalCode: string; servicePointId?: number }
  | { ok: false; error: string; status: number }
> {
  const fromCheckout = meta.returnRelayPointId?.trim();
  if (fromCheckout) {
    return {
      ok: true,
      relayCode: fromCheckout,
      postalCode: meta.returnRelaySearchPostalCode ?? "",
    };
  }

  const fallback = await resolveDefaultCheckoutReturnRelayHub();
  if (!fallback.ok) {
    return { ok: false, error: fallback.error, status: fallback.status };
  }
  return {
    ok: true,
    relayCode: fallback.selection.code,
    postalCode: fallback.selection.postalCode || fallback.hubPostal,
    servicePointId: fallback.selection.sendcloudServicePointId,
  };
}

function segnaHubAsSendcloudRecipient(): SendcloudOutboundRecipient | { error: string } {
  const hub = getSegnaRecipientFromEnv();
  if (!hub) {
    return { error: "Hub Segna incomplet (MONDR_SEGNA_RECIP_* requis pour le retour)." };
  }
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

function hubRecipientFromServicePoint(
  sp: ResolvedSendcloudServicePoint,
  contact: SendcloudOutboundRecipient,
): SendcloudOutboundRecipient {
  const pc = sp.postalCode.replace(/\D/g, "").slice(0, 5);
  if (pc.length !== 5) return contact;
  const street = sp.street.trim() || sp.label.split("—")[0]?.trim() || contact.addressLine1;
  return {
    name: contact.name.slice(0, 64),
    addressLine1: street.slice(0, 64),
    houseNumber: "1",
    postalCode: pc,
    city: (sp.city.trim() || contact.city).slice(0, 64),
    countryCode: contact.countryCode,
    phone: contact.phone,
    email: contact.email,
  };
}

function memberAsSendcloudRecipient(user: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  adress: string | null;
}): SendcloudOutboundRecipient | { error: string } {
  const fn = user.first_name?.trim() ?? "";
  const ln = user.last_name?.trim() ?? "";
  const email = user.email?.trim() ?? "";
  const phone = String(user.phone ?? "").replace(/\s/g, "").trim();
  const parsed = parseMemberAdressForShipment(user.adress);
  if (!fn || !ln || !email || !phone) {
    return { error: "Profil incomplet (prénom, nom, email, téléphone)." };
  }
  if (!parsed?.sender_street || !parsed.sender_postcode || !parsed.sender_city) {
    return { error: "Adresse profil incomplète (rue, n°, CP, ville)." };
  }
  const country = (parsed.sender_country?.trim().toUpperCase() || "FR").slice(0, 2);
  return {
    name: `${fn} ${ln}`.trim().slice(0, 64),
    addressLine1: parsed.sender_street.trim().slice(0, 64),
    houseNumber: parsed.sender_houseno?.trim().slice(0, 16) || "1",
    postalCode: parsed.sender_postcode.replace(/\D/g, "").slice(0, 5),
    city: parsed.sender_city.slice(0, 64),
    countryCode: country.length === 2 ? country : "FR",
    phone: (normalizeFrenchPhoneToE164(phone) || "+33600000000").slice(0, 32),
    email: email.slice(0, 128),
  };
}

async function resolveReturnShippingOptionCode(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  hubPostalCode: string,
  itemCount: number,
): Promise<string | null> {
  const explicit = process.env.SENDCLOUD_SHIPPING_OPTION_RETURN?.trim();
  if (explicit) return explicit;

  const pc = hubPostalCode.replace(/\D/g, "").slice(0, 5);
  if (env.checkoutConfigurationId && pc.length === 5) {
    const { options } = await fetchSendcloudDeliveryOptions(env, {
      toPostalCode: pc,
      toCountry: "FR",
      weightGrams: exchangeShippingWeightGrams(itemCount),
      orderValueEur: 1,
    });
    const picked = pickSendcloudDeliveryOption(options, "relay");
    if (picked?.checkoutIdentifierValue) return picked.checkoutIdentifierValue;
  }

  if (env.relayShippingOptionCode) return env.relayShippingOptionCode;
  if (env.relayShippingMethodId) {
    return resolveRelayShippingOptionCode(env, env.relayShippingMethodId);
  }
  return null;
}

async function readOutboundReturnRelayMeta(
  admin: SupabaseClient,
  cartId: string,
): Promise<CheckoutReturnRelayMeta> {
  const { data: outShip } = await admin
    .from("shipments")
    .select("shipment_destinations ( metadata )")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const destEmb = (outShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const destRows = Array.isArray(destEmb) ? destEmb : destEmb ? [destEmb] : [];
  for (const d of destRows) {
    if (!d || typeof d !== "object") continue;
    const meta = (d as { metadata?: Record<string, unknown> }).metadata;
    const parsed = readCheckoutReturnRelayFromOutboundMetadata(meta);
    if (parsed.returnRelayPointId) return parsed;
  }
  return readCheckoutReturnRelayFromOutboundMetadata(undefined);
}

/**
 * Retour panier emprunt via Sendcloud : membre → hub relais Segna, étiquette PDF gratuite (incluse au checkout).
 */
export async function runCartReturnSendcloudAutoGenerate(
  admin: SupabaseClient,
  params: { userId: string; cartId: string },
): Promise<CartReturnSendcloudAutoResult> {
  const { userId, cartId } = params;
  if (!CART_ID_RE.test(cartId)) {
    return { ok: false, error: "cart_id invalide", status: 400 };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return {
      ok: false,
      error: "Expédition retour indisponible : Sendcloud non configuré.",
      status: 501,
      developer_hint: "SENDCLOUD_PUBLIC_KEY, SENDCLOUD_SECRET_KEY, hub retour (SENDCLOUD_RETURN_HUB_* / MONDR_SEGNA_*).",
    };
  }

  const { data: cart } = await admin
    .from("carts")
    .select("id,user_id,status")
    .eq("id", cartId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cart || cart.user_id !== userId) {
    return { ok: false, error: "Panier introuvable", status: 404 };
  }
  if (cart.status !== "confirmed") {
    return { ok: false, error: "Panier non éligible au retour.", status: 400 };
  }

  const { data: outbound } = await admin
    .from("shipments")
    .select("id,status")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!outbound || String(outbound.status).toLowerCase() !== "delivered") {
    return {
      ok: false,
      error: "La livraison aller doit être indiquée comme livrée avant le retour.",
      status: 400,
    };
  }

  const { data: returnCartItemRows, count: packLineCountRaw } = await admin
    .from("cart_items")
    .select(
      "id, item_id, items(id, title, price_points, item_custom_brand_label, item_brands(label))",
      { count: "exact" },
    )
    .eq("cart_id", cartId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const packLineCount = Math.min(Math.max(packLineCountRaw ?? returnCartItemRows?.length ?? 1, 1), 10);
  const returnOrderItemLines = (returnCartItemRows ?? []).map((row) =>
    mapCartItemJoinToSendcloudOrderInput(row as Parameters<typeof mapCartItemJoinToSendcloudOrderInput>[0]),
  );

  const returnRelayMeta = await readOutboundReturnRelayMeta(admin, cartId);
  const hubTarget = await resolveReturnHubRelayTarget(returnRelayMeta);
  if (!hubTarget.ok) {
    return { ok: false, error: hubTarget.error, status: hubTarget.status };
  }

  let hubResolved: ResolvedSendcloudServicePoint;
  if (hubTarget.servicePointId != null && hubTarget.servicePointId > 0) {
    hubResolved = {
      id: hubTarget.servicePointId,
      displayCode: hubTarget.relayCode,
      carrier: "mondial_relay",
      postNumber: null,
      postalCode: hubTarget.postalCode.replace(/\D/g, "").slice(0, 5),
      city: "",
      street: "",
      label: returnRelayMeta.returnRelayLabel ?? hubTarget.relayCode,
    };
  } else {
    const resolved = await resolveSendcloudServicePointId(env, {
      relayCode: hubTarget.relayCode,
      country: "FR",
      postalCode: hubTarget.postalCode,
    });
    if ("error" in resolved) {
      return { ok: false, error: resolved.error, status: 422 };
    }
    hubResolved = resolved;
  }

  let returnShipId: string;
  let returnStatus: string;
  const { data: existingReturn } = await admin
    .from("shipments")
    .select("id,status")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingReturn?.id) {
    returnShipId = String(existingReturn.id);
    returnStatus =
      normalizeCartReturnShipmentStatus(String(existingReturn.status ?? "")) ?? "pending";
  } else {
    const { data: inserted, error: insErr } = await admin
      .from("shipments")
      .insert({
        cart_id: cartId,
        context: "cart_return",
        status: "pending",
      })
      .select("id,status")
      .single();
    if (insErr || !inserted?.id) {
      return {
        ok: false,
        error: insErr?.message ?? "Création expédition retour impossible",
        status: 500,
      };
    }
    returnShipId = String(inserted.id);
    returnStatus = "pending";
  }

  if (isCartReturnLockedForMemberSetup(returnStatus)) {
    return { ok: false, error: "Cette expédition retour est déjà prise en charge.", status: 409 };
  }

  const { data: existingLabels } = await admin
    .from("shipment_labels")
    .select("label_url")
    .eq("shipment_id", returnShipId)
    .limit(1);
  const firstLab = existingLabels?.[0] as { label_url?: string } | undefined;
  if (firstLab?.label_url?.trim()) {
    const labelUrl = firstLab.label_url.trim();
    const { data: shipRow } = await admin
      .from("shipments")
      .select("tracking_number")
      .eq("id", returnShipId)
      .maybeSingle();
    const tn = (shipRow as { tracking_number?: string } | null)?.tracking_number ?? null;

    if (returnStatus === "pending") {
      const { error: providerErr } = await admin.rpc("set_shipment_provider", {
        p_shipment_id: returnShipId,
        p_provider_code: "sendcloud",
      });
      if (providerErr) {
        return { ok: false, error: `Transporteur : ${providerErr.message}`, status: 500 };
      }
      const tr = await transitionShipmentStatus(admin, {
        shipmentId: returnShipId,
        ifCurrentStatus: "pending",
        toStatus: "ready",
        actorUserId: userId,
        reason: "Étiquette retour déjà présente — alignement statut membre",
        source: "member_app_cart_return_sendcloud_auto_reuse",
        context: { cart_id: cartId },
        occurredAt: new Date().toISOString(),
      });
      if (!tr.ok) {
        return { ok: false, error: tr.error, status: tr.error === "STATUS_MISMATCH" ? 409 : 500 };
      }
    }

    return {
      ok: true,
      shipment_id: returnShipId,
      label_url: labelUrl,
      numero_suivi: typeof tn === "string" && tn.trim() ? tn.trim() : null,
      reused: true,
    };
  }

  if (returnStatus !== "pending" && returnStatus !== "ready") {
    return { ok: false, error: `Statut retour inattendu : ${returnStatus}`, status: 409 };
  }

  const { data: member } = await admin
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", userId)
    .maybeSingle();
  if (!member) {
    return { ok: false, error: "Profil membre introuvable", status: 400 };
  }

  const shipper = memberAsSendcloudRecipient(member as Parameters<typeof memberAsSendcloudRecipient>[0]);
  if ("error" in shipper) {
    return { ok: false, error: shipper.error, status: 400 };
  }

  const hubContact = segnaHubAsSendcloudRecipient();
  if ("error" in hubContact) {
    return { ok: false, error: hubContact.error, status: 501 };
  }
  const hubRecipient = hubRecipientFromServicePoint(hubResolved, hubContact);

  const logisticsHub = getSegnaLogisticsHubFromEnv();
  const shippingOptionCode = await resolveReturnShippingOptionCode(
    env,
    hubResolved.postalCode || logisticsHub?.postalCode || hubTarget.postalCode,
    packLineCount,
  );
  if (!shippingOptionCode) {
    return {
      ok: false,
      error:
        "Option livraison retour Sendcloud introuvable (SENDCLOUD_SHIPPING_OPTION_RETURN ou Dynamic Checkout).",
      status: 501,
    };
  }

  const orderNumber = buildSendcloudOrderNumber({
    cartId,
    shipmentId: returnShipId,
    generation: 1,
  });

  const announceBody = buildReturnShipmentAnnounceBody({
    orderNumber,
    shippingOptionCode,
    shipper,
    hubRecipient,
    hubServicePointId: hubResolved.id,
    hubPostNumber: hubResolved.postNumber,
    itemCount: packLineCount,
  });

  let announced = await announceSendcloudShipmentSync(env, announceBody);
  if (!announced.ok && process.env.SENDCLOUD_SHIPMENTS_V3_ONLY !== "1") {
    const integrationId = await resolveSendcloudIntegrationId(env);
    if (integrationId) {
      const upsert = await upsertSendcloudOrders(env, [
        buildSegnaSendcloudOrderRow({
          orderId: orderNumber,
          orderNumber,
          integrationId,
          shippingOptionCode,
          recipient: hubRecipient,
          servicePointId: hubResolved.id,
          orderItemLines: returnOrderItemLines,
        }),
      ]);
      if (upsert.ok) {
        const viaOrder = await createSendcloudOrderLabelSync(env, {
          integration_id: integrationId,
          order: { order_number: orderNumber },
          ship_with: {
            type: "shipping_option_code",
            properties: { shipping_option_code: shippingOptionCode },
          },
        });
        if (viaOrder.ok) {
          announced = {
            ok: true,
            parcel: { id: viaOrder.parcelId, tracking_number: viaOrder.trackingNumber },
            labelUrl: viaOrder.labelUrl,
          };
        }
      }
    }
  }

  if (!announced.ok) {
    return { ok: false, error: announced.error, status: 502 };
  }

  const trackingNumber = String(announced.parcel.tracking_number ?? "").trim();
  const labelUrl = announced.labelUrl;
  const trackingUrl =
    typeof announced.parcel.tracking_url === "string" && announced.parcel.tracking_url.trim().startsWith("http")
      ? announced.parcel.tracking_url.trim()
      : null;

  const { error: providerErr } = await admin.rpc("set_shipment_provider", {
    p_shipment_id: returnShipId,
    p_provider_code: "sendcloud",
  });
  if (providerErr) {
    return { ok: false, error: `Transporteur : ${providerErr.message}`, status: 500 };
  }

  const nowIso = new Date().toISOString();
  if (returnStatus === "ready") {
    const { error: upShipErr } = await admin
      .from("shipments")
      .update({
        tracking_number: trackingNumber || null,
        ...(trackingUrl ? { member_tracking_url: trackingUrl } : {}),
        updated_at: nowIso,
      })
      .eq("id", returnShipId)
      .eq("status", "ready");
    if (upShipErr) {
      return { ok: false, error: `Étiquette ok mais mise à jour envoi : ${upShipErr.message}`, status: 500 };
    }
  } else {
    const tr = await transitionShipmentStatus(admin, {
      shipmentId: returnShipId,
      ifCurrentStatus: "pending",
      toStatus: "ready",
      actorUserId: userId,
      reason: "Étiquette retour Sendcloud générée (auto)",
      source: "member_app_cart_return_sendcloud_auto_generate",
      context: { cart_id: cartId },
      occurredAt: nowIso,
      trackingNumber: trackingNumber || undefined,
    });
    if (!tr.ok) {
      return {
        ok: false,
        error: `Étiquette ok mais mise à jour envoi : ${tr.error}`,
        status: tr.error === "STATUS_MISMATCH" ? 409 : 500,
      };
    }
    if (trackingUrl) {
      await admin
        .from("shipments")
        .update({ member_tracking_url: trackingUrl, updated_at: nowIso })
        .eq("id", returnShipId);
    }
  }

  const { error: labErr } = await admin.from("shipment_labels").insert({
    shipment_id: returnShipId,
    label_url: labelUrl,
    label_format: "pdf",
    label_status: "created",
  });
  if (labErr) {
    return {
      ok: false,
      error: `Étiquette créée mais enregistrement impossible : ${labErr.message}`,
      status: 500,
    };
  }

  return {
    ok: true,
    shipment_id: returnShipId,
    label_url: labelUrl,
    numero_suivi: trackingNumber || null,
  };
}
