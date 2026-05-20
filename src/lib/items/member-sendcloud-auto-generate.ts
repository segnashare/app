import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSegnaRecipientFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import {
  clearItemIntakeMondialRelayMetadata,
  clearItemIntakeShippingLabelMetadata,
  patchItemIntakeSendcloudMetadata,
} from "@/lib/items/item-intake-sendcloud-patch";
import {
  intakeShippingLabelMatchesItemGroup,
  parseSendcloudFromIntakeMetadata,
} from "@/lib/items/intake-shipping-metadata";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import {
  hubCarrierForIntakeShippingOption,
  resolveIntakeShop2ShopShippingOptionCode,
} from "@/lib/sendcloud/resolve-intake-shop2shop-shipping-option";
import { resolveSendcloudIntegrationId } from "@/lib/sendcloud/integrations";
import { getSegnaLogisticsHubFromEnv } from "@/lib/sendcloud/logistics-hub";
import { type SendcloudOrderItemInput } from "@/lib/sendcloud/build-sendcloud-order-items";
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
export const SENDCLOUD_AUTO_GENERATE_ENV_HINT =
  "Sur le serveur de l’app membre : SENDCLOUD_PUBLIC_KEY, SENDCLOUD_SECRET_KEY, hub retour (SENDCLOUD_RETURN_HUB_SERVICE_POINT_IDS ou MONDR_SEGNA_RETURN_DELIVERY_RELAY_CODE), SENDCLOUD_SHIPPING_OPTION_INTAKE (Shop2Shop 0,5–1 kg). Redémarre Next après mise à jour de .env.local.";

type ItemRow = {
  id: string;
  title: string | null;
  price_points: number | null;
  owner_user_id: string;
  deleted_at: string | null;
  item_categories: { name: string | null } | { name: string | null }[] | null;
  item_intake:
    | { listing_stage: string; fulfillment_stage: string | null; metadata?: unknown }
    | { listing_stage: string; fulfillment_stage: string | null; metadata?: unknown }[]
    | null;
};

function unwrapIntake(emb: ItemRow["item_intake"]) {
  if (!emb) return null;
  const row = Array.isArray(emb) ? emb[0] : emb;
  if (!row || typeof row !== "object") return null;
  return row;
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
    return { error: "Complète prénom, nom, email et téléphone dans ton profil." };
  }
  if (!parsed?.sender_street || !parsed.sender_postcode || !parsed.sender_city) {
    return { error: "Complète ton adresse postale dans ton profil (rue, n°, CP, ville)." };
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

async function recordMemberScFailure(service: SupabaseClient, ids: string[], msg: string) {
  const iso = new Date().toISOString();
  const short = msg.slice(0, 400);
  for (const id of ids) {
    await patchItemIntakeSendcloudMetadata(service, id, {
      last_member_sc_error_at: iso,
      last_member_sc_error_message: short,
    });
  }
}

function readPendingSegnaOrderNumber(typed: ItemRow[]): string | null {
  for (const r of typed) {
    const sc = parseSendcloudFromIntakeMetadata(unwrapIntake(r.item_intake)?.metadata ?? null);
    if (sc?.label_url?.trim()) continue;
    const on = String(sc?.reference_expedition ?? "").trim();
    if (on.startsWith("segna-")) return on;
  }
  return null;
}

export async function runMemberSendcloudAutoGenerate(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[]; force?: boolean },
): Promise<
  | { ok: true; label_url: string; numero_suivi: string | null; item_ids: string[] }
  | { ok: false; error: string; status: number; developerHint?: string }
> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1 || sortedIds.length > 5) {
    return { ok: false, error: "Entre 1 et 5 pièces requises.", status: 400 };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return {
      ok: false,
      error: "Expédition automatique indisponible : Sendcloud non configuré sur ce serveur.",
      status: 501,
      developerHint: SENDCLOUD_AUTO_GENERATE_ENV_HINT,
    };
  }

  const { data: rows, error: qerr } = await service
    .from("items")
    .select(
      "id,title,price_points,owner_user_id,deleted_at, item_categories(name), item_intake(listing_stage,fulfillment_stage,metadata)",
    )
    .in("id", sortedIds);

  if (qerr || !rows || rows.length !== sortedIds.length) {
    return { ok: false, error: "Pièce introuvable ou accès refusé.", status: 403 };
  }

  const typed = rows as unknown as ItemRow[];
  for (const r of typed) {
    if (r.owner_user_id !== params.userId || r.deleted_at != null) {
      return { ok: false, error: "Accès refusé à au moins une pièce.", status: 403 };
    }
    const intake = unwrapIntake(r.item_intake);
    const fs = String(intake?.fulfillment_stage ?? "").toLowerCase();
    const canShip =
      intake &&
      String(intake.listing_stage) === "validated" &&
      (!fs || fs === "ready" || fs === "shipping");
    if (!canShip) {
      return {
        ok: false,
        error: "Une pièce n'est pas en phase expédition (validée + livraison à préparer).",
        status: 400,
      };
    }
  }

  let reuseExisting = false;
  for (const r of typed) {
    const sc = parseSendcloudFromIntakeMetadata(unwrapIntake(r.item_intake)?.metadata ?? null);
    const labelUrl = sc?.label_url?.trim() ?? "";
    const shop2Shop = /shop2shop/i.test(String(sc?.notes_interne ?? ""));
    if (labelUrl && shop2Shop && intakeShippingLabelMatchesItemGroup(sortedIds, sc)) {
      reuseExisting = true;
      break;
    }
  }

  if (reuseExisting) {
    const sc = parseSendcloudFromIntakeMetadata(unwrapIntake(typed[0]!.item_intake)?.metadata ?? null);
    return {
      ok: true,
      label_url: sc!.label_url!.trim(),
      numero_suivi: sc?.numero_suivi?.trim() || null,
      item_ids: sortedIds,
    };
  }

  if (params.force) {
    for (const id of sortedIds) {
      await clearItemIntakeShippingLabelMetadata(service, id);
    }
  }

  const { data: member, error: memErr } = await service
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", params.userId)
    .maybeSingle();
  if (memErr || !member) {
    return { ok: false, error: "Profil membre introuvable.", status: 400 };
  }

  const shipper = memberAsSendcloudRecipient(member as Parameters<typeof memberAsSendcloudRecipient>[0]);
  if ("error" in shipper) {
    return { ok: false, error: shipper.error, status: 400 };
  }

  const memberPc = (() => {
    const parsed = parseMemberAdressForShipment((member.adress as string | null | undefined) ?? null);
    return (parsed?.sender_postcode ?? "").replace(/\D/g, "").slice(0, 5);
  })();

  const logisticsHub = getSegnaLogisticsHubFromEnv();
  const hubPostalGuess = logisticsHub?.postalCode.replace(/\D/g, "").slice(0, 5) ?? "75017";

  const shippingOptionCode = await resolveIntakeShop2ShopShippingOptionCode(env, {
    hubPostalCode: hubPostalGuess,
    memberPostalCode: memberPc,
  });
  if (!shippingOptionCode) {
    const msg =
      "Option Shop2Shop 0,5–1 kg introuvable (SENDCLOUD_SHIPPING_OPTION_INTAKE ou Dynamic Checkout Chronopost).";
    await recordMemberScFailure(service, sortedIds, msg);
    return { ok: false, error: msg, status: 501, developerHint: SENDCLOUD_AUTO_GENERATE_ENV_HINT };
  }

  const hubCarrier = hubCarrierForIntakeShippingOption(shippingOptionCode);
  const hubListed = await resolveDefaultCheckoutReturnRelayHub({ carrier: hubCarrier });
  if (!hubListed.ok) {
    return { ok: false, error: hubListed.error, status: hubListed.status };
  }

  let hubResolved: ResolvedSendcloudServicePoint;
  const hubSel = hubListed.selection;
  if (hubSel.sendcloudServicePointId != null && hubSel.sendcloudServicePointId > 0) {
    hubResolved = {
      id: hubSel.sendcloudServicePointId,
      displayCode: hubSel.code,
      carrier: hubSel.sendcloudCarrier ?? hubCarrier,
      postNumber: hubSel.sendcloudPostNumber ?? null,
      postalCode: hubSel.postalCode.replace(/\D/g, "").slice(0, 5),
      city: hubSel.city ?? "",
      street: "",
      label: hubSel.label,
    };
  } else {
    const resolved = await resolveSendcloudServicePointId(env, {
      relayCode: hubSel.code,
      country: "FR",
      postalCode: hubSel.postalCode,
    });
    if ("error" in resolved) {
      return { ok: false, error: resolved.error, status: 422 };
    }
    hubResolved = resolved;
  }

  const hubContact = segnaHubAsSendcloudRecipient();
  if ("error" in hubContact) {
    return { ok: false, error: hubContact.error, status: 501 };
  }
  const hubRecipient = hubRecipientFromServicePoint(hubResolved, hubContact);

  const shipmentKey = createHash("sha256").update(sortedIds.join("|")).digest("hex").slice(0, 16);
  const pendingOrder = params.force ? null : readPendingSegnaOrderNumber(typed);
  const orderNumber =
    pendingOrder ??
    buildSendcloudOrderNumber({
      cartId: sortedIds[0]!,
      shipmentId: shipmentKey,
      generation: params.force ? Math.max(2, Math.floor(Date.now() / 1000) % 999_999) : 1,
    });

  for (const id of sortedIds) {
    await patchItemIntakeSendcloudMetadata(service, id, {
      sc_order_number: orderNumber,
      reference_expedition: orderNumber,
    });
  }

  const integrationId = await resolveSendcloudIntegrationId(env);

  type AnnouncedOk = {
    ok: true;
    parcel: { id: number; tracking_number?: string; tracking_url?: string | null };
    labelUrl: string;
  };
  let announced: AnnouncedOk | { ok: false; error: string } = { ok: false, error: "Étiquette non créée." };

  if (integrationId) {
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

  if (!announced.ok) {
    const announceBody = buildReturnShipmentAnnounceBody({
      orderNumber,
      shippingOptionCode,
      shipper,
      hubRecipient,
      hubServicePointId: hubResolved.id,
      hubPostNumber: hubResolved.postNumber,
    });

    const announcedV3 = await announceSendcloudShipmentSync(env, announceBody);
    if (announcedV3.ok) {
      announced = announcedV3;
    } else if (integrationId && process.env.SENDCLOUD_SHIPMENTS_V3_ONLY !== "1") {
      const orderItemLines: SendcloudOrderItemInput[] = sortedIds.map((id) => {
        const row = typed.find((r) => r.id === id);
        return { title: row?.title ?? null, pricePoints: row?.price_points ?? null };
      });
      const upsert = await upsertSendcloudOrders(env, [
        buildSegnaSendcloudOrderRow({
          orderId: orderNumber,
          orderNumber,
          integrationId,
          shippingOptionCode,
          recipient: hubRecipient,
          servicePointId: hubResolved.id,
          orderItemLines,
        }),
      ]);
      if (upsert.ok) {
        const retryLabel = await createSendcloudOrderLabelSync(env, {
          integration_id: integrationId,
          order: { order_number: orderNumber },
          ship_with: {
            type: "shipping_option_code",
            properties: { shipping_option_code: shippingOptionCode },
          },
        });
        if (retryLabel.ok) {
          announced = {
            ok: true,
            parcel: { id: retryLabel.parcelId, tracking_number: retryLabel.trackingNumber },
            labelUrl: retryLabel.labelUrl,
          };
        } else {
          announced = { ok: false, error: retryLabel.error };
        }
      } else {
        announced = { ok: false, error: upsert.error };
      }
    } else {
      announced = { ok: false, error: announcedV3.error };
    }
  }

  if (!announced.ok) {
    await recordMemberScFailure(service, sortedIds, announced.error);
    return { ok: false, error: announced.error, status: 502 };
  }

  const trackingNumber = String(announced.parcel.tracking_number ?? "").trim();
  const labelUrl = announced.labelUrl;
  const trackingUrl =
    typeof announced.parcel.tracking_url === "string" && announced.parcel.tracking_url.trim().startsWith("http")
      ? announced.parcel.tracking_url.trim()
      : null;

  const single = sortedIds.length === 1;
  const metaNotes = single
    ? `Sendcloud Shop2Shop 0,5–1 kg — hub ${hubResolved.label}`.slice(0, 2000)
    : `Sendcloud Shop2Shop fusion (${sortedIds.length} pièces) — hub ${hubResolved.label}`.slice(0, 2000);

  const removeKeys = [
    "last_member_sc_error_at",
    "last_member_sc_error_message",
    ...(single ? (["sc_merge_item_ids"] as const) : []),
  ];

  for (const id of sortedIds) {
    const patchRes = await patchItemIntakeSendcloudMetadata(
      service,
      id,
      {
        label_url: labelUrl,
        numero_suivi: trackingNumber || null,
        reference_expedition: trackingNumber || orderNumber,
        lien_suivi: trackingUrl,
        notes_interne: metaNotes,
        last_backoffice_update_at: new Date().toISOString(),
        ...(single ? {} : { sc_merge_item_ids: sortedIds.join(",") }),
      },
      { removeKeys: [...removeKeys] },
    );
    if (!patchRes.ok) {
      return { ok: false, error: patchRes.message, status: 500 };
    }
    await clearItemIntakeMondialRelayMetadata(service, id);
    await service.from("item_intake").update({ fulfillment_stage: "ready" }).eq("item_id", id);
  }

  return {
    ok: true,
    label_url: labelUrl,
    numero_suivi: trackingNumber || null,
    item_ids: sortedIds,
  };
}
