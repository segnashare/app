import type { SupabaseClient } from "@supabase/supabase-js";

import { isIntakeCartReturnPiggybackActive } from "@/lib/items/intake-cart-return-piggyback";
import { intakeAllowsShippingPreparation } from "@/lib/items/intake-fulfillment-stages";
import {
  clearItemIntakeShippingLabelMetadata,
  patchItemIntakeSendcloudMetadata,
} from "@/lib/items/item-intake-sendcloud-patch";
import {
  archiveMemberIntakeShipment,
  buildStableMemberIntakeOrderNumber,
  cancelMemberIntakeSendcloudArtifacts,
  consolidateMemberIntakeShippingGroup,
  ensureMemberIntakeShipmentForPortal,
  loadMemberIntakeSendcloudCancelInput,
  MEMBER_INTAKE_SHIPMENT_MAX_ITEMS,
  needsMemberIntakeGroupConsolidation,
  readMemberIntakeDestinationMetadata,
  resetMemberIntakeShipmentForPortal,
  resolveActiveMemberIntakeShipmentIdForItems,
  resolveMemberIntakeReturnTracking,
  saveMemberIntakePortalBaseUrl,
  SC_MEMBER_INTAKE_SHIPMENT_ID,
  SC_RETURN_PORTAL_BASE_URL,
  syncMemberIntakeReturnFromSendcloudByOrder,
  syncMemberIntakeShipmentPortalIds,
  pruneStaleSendcloudReturnsForOrder,
  syncMemberIntakeShipmentTracking,
  patchMemberIntakeShipmentReturnParcel,
} from "@/lib/items/member-intake-shipment";
import {
  isIntakeMemberReturnTrackingNumber,
  parseIntakeShippingLabelFromMetadata,
  parseSendcloudFromIntakeMetadata,
  SC_SHIPPING_PREFER_SOLO,
} from "@/lib/items/intake-shipping-metadata";
import { buildCarrierTrackingUrlFromNumber } from "@/lib/shipping/intake-carrier-tracking";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { resolveSendcloudSenderAddressId } from "@/lib/sendcloud/integrations";
import { cancelSendcloudOutboundParcel } from "@/lib/sendcloud/orders-api";
import {
  buildReturnPortalIncomingBody,
  createReturnPortalIncoming,
  fetchReturnPortalOutgoing,
  getIntakeReturnPortalReasonId,
  pollReturnPortalLabel,
} from "@/lib/sendcloud/return-portal-api";
import {
  buildReturnPortalUrlWithPrefill,
  cancelSendcloudShipment,
  createDummyOutboundShipmentForReturnPortal,
  fetchSendcloudReturnPortalUrl,
  stripReturnPortalUrlToBase,
} from "@/lib/sendcloud/return-portal-shipment";
import type { SendcloudOutboundRecipient } from "@/lib/sendcloud/shipments";

export const SENDCLOUD_RETURN_PORTAL_ENV_HINT =
  "SENDCLOUD_PUBLIC_KEY, SENDCLOUD_SECRET_KEY, SENDCLOUD_SENDER_ADDRESS_ID (adresse expéditeur Segna), portail retours activé sur la marque Sendcloud.";

type ItemRow = {
  id: string;
  owner_user_id: string;
  deleted_at: string | null;
  item_intake:
    | { listing_stage: string; fulfillment_stage: string | null; metadata?: unknown }
    | { listing_stage: string; fulfillment_stage: string | null; metadata?: unknown }[]
    | null;
};

function unwrapIntake(
  emb:
    | ItemRow["item_intake"]
    | { metadata?: unknown }
    | { metadata?: unknown }[]
    | null
    | undefined,
) {
  if (!emb) return null;
  const row = Array.isArray(emb) ? emb[0] : emb;
  if (!row || typeof row !== "object") return null;
  return row as {
    listing_stage?: string;
    fulfillment_stage?: string | null;
    metadata?: unknown;
  };
}

function memberAsRecipient(user: {
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

async function recordPortalFailure(service: SupabaseClient, ids: string[], msg: string) {
  const iso = new Date().toISOString();
  for (const id of ids) {
    await patchItemIntakeSendcloudMetadata(service, id, {
      last_member_sc_error_at: iso,
      last_member_sc_error_message: msg.slice(0, 400),
    });
  }
}

function buildReturnPortalDevHint(detail: {
  error: string;
  sendcloudStatus?: number;
  sendcloudRaw?: unknown;
  context?: Record<string, unknown>;
}): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const parts = [
    detail.sendcloudStatus != null ? `HTTP ${detail.sendcloudStatus}` : null,
    detail.error,
    detail.context ? JSON.stringify(detail.context) : null,
    detail.sendcloudRaw != null ? JSON.stringify(detail.sendcloudRaw).slice(0, 700) : null,
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 1200) || undefined;
}

function parsePortalParcelId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readPortalFromMeta(metadata: unknown): {
  portalUrl: string | null;
  orderNumber: string | null;
  portalIdentifier: string | null;
  shipmentId: string | null;
  cancelAfterAt: string | null;
  cancelledAt: string | null;
  postalCode: string | null;
  labelUrl: string | null;
} {
  const empty = {
    portalUrl: null,
    orderNumber: null,
    portalIdentifier: null,
    shipmentId: null,
    cancelAfterAt: null,
    cancelledAt: null,
    postalCode: null,
    labelUrl: null,
  };
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return empty;
  }
  const sc = (metadata as Record<string, unknown>).sendcloud;
  if (sc == null || typeof sc !== "object" || Array.isArray(sc)) {
    return empty;
  }
  const m = sc as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === "string" ? m[k].trim() : "");
  return {
    portalUrl: str("sc_return_portal_url") || null,
    orderNumber: str("sc_order_number") || str("reference_expedition") || null,
    portalIdentifier: str("sc_return_portal_identifier") || null,
    shipmentId: str("sc_dummy_shipment_id") || null,
    cancelAfterAt: str("sc_dummy_cancel_after_at") || null,
    cancelledAt: str("sc_dummy_shipment_cancelled_at") || null,
    postalCode: str("sc_return_portal_postal_code") || null,
    labelUrl: str("label_url") || null,
  };
}

/**
 * Session portail expirée (legacy : délai `sc_dummy_cancel_after_at` sans annulation immédiate).
 * Étiquette retour déjà générée ou URL portail valide = session toujours utilisable.
 * `sc_dummy_shipment_cancelled_at` = aller factice annulé (comportement normal), pas une expiration.
 */
export function isIntakeReturnPortalSessionExpired(
  portal: ReturnType<typeof readPortalFromMeta>,
): boolean {
  if (portal.labelUrl?.startsWith("http")) return false;
  if (!portal.portalUrl?.startsWith("http")) return false;
  const until = portal.cancelAfterAt ? Date.parse(portal.cancelAfterAt) : NaN;
  if (Number.isFinite(until) && until <= Date.now() && !portal.cancelledAt) return true;
  return false;
}

function collectIntakeReturnTrackingKeepKeys(
  typed: ItemRow[],
  shipmentTracking: string | null | undefined,
): string[] {
  const keys = new Set<string>();
  const shipTn = String(shipmentTracking ?? "").trim();
  if (isIntakeMemberReturnTrackingNumber(shipTn)) {
    keys.add(shipTn.toUpperCase());
  }
  for (const r of typed) {
    const label = parseIntakeShippingLabelFromMetadata(unwrapIntake(r.item_intake)?.metadata ?? null);
    const tn = label?.numero_suivi?.trim() ?? "";
    if (isIntakeMemberReturnTrackingNumber(tn)) {
      keys.add(tn.toUpperCase());
    }
  }
  return [...keys];
}

async function pruneStaleIntakeReturnsForPortalStart(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  orderNumber: string,
  keepTrackingNumbers: string[],
): Promise<void> {
  const soloOrder = orderNumber.trim();
  if (!soloOrder) return;
  await pruneStaleSendcloudReturnsForOrder(env, soloOrder, keepTrackingNumbers).catch(() => undefined);
}

/** Annule l’expédition aller factice si le délai est dépassé. */
export async function cancelDueIntakeDummyShipments(
  service: SupabaseClient,
  itemIds: string[],
): Promise<void> {
  const env = getSendcloudEnv();
  if (!env) return;

  const { data: rows } = await service
    .from("item_intake")
    .select("item_id,metadata")
    .in("item_id", itemIds);
  if (!rows?.length) return;

  const now = Date.now();
  for (const row of rows) {
    const { shipmentId, cancelAfterAt } = readPortalFromMeta(row.metadata);
    if (!shipmentId || !cancelAfterAt) continue;
    if (Date.parse(cancelAfterAt) > now) continue;
    const cancelled = await cancelSendcloudShipment(env, shipmentId);
    if (cancelled.ok) {
      await patchItemIntakeSendcloudMetadata(service, String(row.item_id), {
        sc_dummy_shipment_cancelled_at: new Date().toISOString(),
      });
    }
  }
}

/** Annule l’expédition aller factice créée pour débloquer l’URL portail (le retour membre est séparé). */
async function cancelDummyOutboundAfterReturnPortalUrl(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  created: { shipmentId: string; parcelId: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cancelled = await cancelSendcloudShipment(env, created.shipmentId);
  if (!cancelled.ok) {
    return { ok: false, error: cancelled.error };
  }
  if (created.parcelId != null) {
    await cancelSendcloudOutboundParcel(env, created.parcelId).catch(() => undefined);
  }
  return { ok: true };
}

function collectPanelShipmentIdsFromRows(typed: ItemRow[]): string[] {
  const ids = new Set<string>();
  for (const r of typed) {
    const portal = readPortalFromMeta(unwrapIntake(r.item_intake)?.metadata ?? null);
    if (portal.shipmentId) ids.add(portal.shipmentId);
  }
  return [...ids];
}

async function patchIntakeReturnPortalSession(
  service: SupabaseClient,
  params: {
    itemIds: string[];
    portalUrl: string;
    orderNumber: string;
    postalCode: string;
    portalIdentifier: string;
    memberIntakeShipmentId: string;
    notes: string;
    extraPatch?: Record<string, string | null | undefined>;
    removeKeys?: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const single = params.itemIds.length === 1;
  const defaultRemove = [
    "last_member_sc_error_at",
    "last_member_sc_error_message",
    "label_url",
    "numero_suivi",
    "lien_suivi",
    "sc_dummy_shipment_id",
    "sc_outgoing_parcel_id",
    "sc_dummy_cancel_after_at",
    "sc_dummy_shipment_cancelled_at",
    ...(single ? [] : [SC_SHIPPING_PREFER_SOLO]),
  ];

  for (const id of params.itemIds) {
    const patchRes = await patchItemIntakeSendcloudMetadata(
      service,
      id,
      {
        sc_return_portal_url: params.portalUrl,
        sc_order_number: params.orderNumber,
        sc_return_portal_identifier: params.portalIdentifier,
        reference_expedition: params.orderNumber,
        sc_return_portal_postal_code: params.postalCode,
        [SC_MEMBER_INTAKE_SHIPMENT_ID]: params.memberIntakeShipmentId,
        notes_interne: params.notes,
        last_backoffice_update_at: new Date().toISOString(),
        ...(single ? {} : { sc_merge_item_ids: params.itemIds.join(",") }),
        ...params.extraPatch,
      },
      { removeKeys: [...defaultRemove, ...(params.removeKeys ?? [])] },
    );
    if (!patchRes.ok) {
      return { ok: false, error: patchRes.message, status: 500 };
    }
    await service.from("item_intake").update({ fulfillment_stage: "ready" }).eq("item_id", id);
  }

  return { ok: true };
}

/** Crée un aller factice Sendcloud + session portail solo (commande indépendante). */
async function bootstrapMemberIntakeSoloReturnPortal(
  service: SupabaseClient,
  params: {
    itemId: string;
    shipmentId: string;
    orderNumber: string;
    recipient: SendcloudOutboundRecipient;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const env = getSendcloudEnv();
  if (!env) {
    return { ok: false, error: "Sendcloud non configuré." };
  }

  const { data: shipRow } = await service
    .from("shipments")
    .select("item_intake_1_id, item_intake_2_id")
    .eq("id", params.shipmentId.trim())
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .maybeSingle();
  if (!shipRow?.item_intake_1_id || String(shipRow.item_intake_1_id) !== params.itemId.trim()) {
    return { ok: false, error: "Expédition intake solo introuvable pour cette pièce." };
  }
  if (shipRow.item_intake_2_id) {
    return { ok: false, error: "Impossible de créer un portail solo sur un lot encore fusionné." };
  }

  const senderAddressId = await resolveSendcloudSenderAddressId(env);
  if (!senderAddressId) {
    return { ok: false, error: "Adresse expéditeur Segna introuvable dans Sendcloud." };
  }

  const created = await createDummyOutboundShipmentForReturnPortal(env, {
    orderNumber: params.orderNumber,
    toRecipient: params.recipient,
    senderAddressId,
  });
  if (!created.ok) {
    return { ok: false, error: created.error };
  }

  const portalRaw = await fetchSendcloudReturnPortalUrl(env, created.shipmentId);
  if (!portalRaw.ok) {
    await cancelSendcloudShipment(env, created.shipmentId).catch(() => undefined);
    return { ok: false, error: portalRaw.error };
  }

  const dummyCancelledAt = new Date().toISOString();
  const cancelDummy = await cancelDummyOutboundAfterReturnPortalUrl(env, created);
  if (!cancelDummy.ok) {
    return { ok: false, error: cancelDummy.error };
  }

  const postalCode = params.recipient.postalCode;
  const portalUrl = buildReturnPortalUrlWithPrefill(portalRaw.url, {
    orderNumber: params.orderNumber,
    postalCode,
    identifier: params.orderNumber,
  });

  await saveMemberIntakePortalBaseUrl(
    service,
    params.shipmentId,
    stripReturnPortalUrlToBase(portalRaw.url),
  );
  await syncMemberIntakeShipmentPortalIds(service, {
    shipmentId: params.shipmentId,
    orderNumber: params.orderNumber,
    panelShipmentId: created.shipmentId,
    outboundParcelId: created.parcelId,
  });

  const patched = await patchIntakeReturnPortalSession(service, {
    itemIds: [params.itemId],
    portalUrl,
    orderNumber: params.orderNumber,
    postalCode,
    portalIdentifier: params.orderNumber,
    memberIntakeShipmentId: params.shipmentId,
    notes:
      "Séparation intake — aller factice solo créé pour retour Sendcloud indépendant.".slice(0, 2000),
    extraPatch: {
      sc_dummy_shipment_id: created.shipmentId,
      ...(created.parcelId != null ? { sc_outgoing_parcel_id: String(created.parcelId) } : {}),
      sc_dummy_shipment_cancelled_at: dummyCancelledAt,
      [SC_SHIPPING_PREFER_SOLO]: "1",
    },
    removeKeys: ["sc_merge_item_ids"],
  });
  if (!patched.ok) {
    return { ok: false, error: patched.error };
  }

  return { ok: true };
}

/** Après split : un aller factice / commande Sendcloud par pièce secondaire. */
export async function bootstrapMemberIntakeSplitSecondaryPortals(
  service: SupabaseClient,
  params: {
    userId: string;
    primaryItemId: string;
    itemShipmentIds: Record<string, string>;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secondaryIds = Object.keys(params.itemShipmentIds)
    .filter((id) => id !== params.primaryItemId)
    .sort();
  if (secondaryIds.length === 0) return { ok: true };

  const { data: member, error: memErr } = await service
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", params.userId)
    .maybeSingle();
  if (memErr || !member) {
    return { ok: false, error: "Profil membre introuvable." };
  }

  const recipient = memberAsRecipient(member as Parameters<typeof memberAsRecipient>[0]);
  if ("error" in recipient) {
    return { ok: false, error: recipient.error };
  }

  for (const itemId of secondaryIds) {
    const shipmentId = params.itemShipmentIds[itemId]?.trim();
    if (!shipmentId) {
      return { ok: false, error: "Expédition intake introuvable pour une pièce du lot." };
    }
    const orderNumber = buildStableMemberIntakeOrderNumber([itemId]);
    const bootstrapped = await bootstrapMemberIntakeSoloReturnPortal(service, {
      itemId,
      shipmentId,
      orderNumber,
      recipient,
    });
    if (!bootstrapped.ok) {
      await recordPortalFailure(service, [itemId], bootstrapped.error);
      return { ok: false, error: bootstrapped.error };
    }
  }

  return { ok: true };
}

export async function runMemberIntakeReturnPortalStart(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[]; force?: boolean },
): Promise<
  | {
      ok: true;
      return_portal_url: string;
      order_number: string;
      postal_code: string;
      item_ids: string[];
    }
  | { ok: false; error: string; status: number; developerHint?: string }
> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1 || sortedIds.length > MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) {
    return {
      ok: false,
      error: `Entre 1 et ${MEMBER_INTAKE_SHIPMENT_MAX_ITEMS} pièces requises.`,
      status: 400,
    };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return {
      ok: false,
      error: "Envoi indisponible : Sendcloud non configuré.",
      status: 501,
      developerHint: SENDCLOUD_RETURN_PORTAL_ENV_HINT,
    };
  }

  const { data: rows, error: qerr } = await service
    .from("items")
    .select("id,owner_user_id,deleted_at,item_intake(listing_stage,fulfillment_stage,metadata)")
    .in("id", sortedIds);

  if (qerr || !rows || rows.length !== sortedIds.length) {
    return { ok: false, error: "Pièce introuvable ou accès refusé.", status: 403 };
  }

  const typed = rows as unknown as ItemRow[];
  for (const r of typed) {
    if (r.owner_user_id !== params.userId || r.deleted_at != null) {
      return { ok: false, error: "Accès refusé.", status: 403 };
    }
    const intake = unwrapIntake(r.item_intake);
    if (
      !intake ||
      String(intake.listing_stage) !== "validated" ||
      !intakeAllowsShippingPreparation(intake.fulfillment_stage)
    ) {
      return { ok: false, error: "Pièce non en phase expédition.", status: 400 };
    }
    if (!params.force && isIntakeCartReturnPiggybackActive(intake.metadata ?? null)) {
      return {
        ok: false,
        error:
          "Tu as choisi d’envoyer cette pièce avec le retour d’un emprunt. Utilise « Pas assez de place » pour repasser sur le portail d’envoi.",
        status: 409,
      };
    }
  }

  if (sortedIds.length >= 2) {
    const { data: intakeForConsolidate } = await service
      .from("item_intake")
      .select("metadata")
      .in("item_id", sortedIds);
    const metasForConsolidate = (intakeForConsolidate ?? []).map((r) => r.metadata);
    if (needsMemberIntakeGroupConsolidation(sortedIds, metasForConsolidate)) {
      const consolidated = await consolidateMemberIntakeShippingGroup(service, {
        userId: params.userId,
        itemIds: sortedIds,
      });
      if (!consolidated.ok) {
        return { ok: false, error: consolidated.error, status: 502 };
      }
    }
  }

  await cancelDueIntakeDummyShipments(service, sortedIds);

  const { data: member, error: memErr } = await service
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", params.userId)
    .maybeSingle();
  if (memErr || !member) {
    return { ok: false, error: "Profil membre introuvable.", status: 400 };
  }

  const recipient = memberAsRecipient(member as Parameters<typeof memberAsRecipient>[0]);
  if ("error" in recipient) {
    return { ok: false, error: recipient.error, status: 400 };
  }

  const orderNumber = buildStableMemberIntakeOrderNumber(sortedIds);

  const ensuredShipment = await ensureMemberIntakeShipmentForPortal(service, {
    ownerUserId: params.userId,
    itemIds: sortedIds,
    orderNumber,
    recipient,
  });
  if (!ensuredShipment.ok) {
    return { ok: false, error: ensuredShipment.error, status: 500 };
  }

  const destMeta = await readMemberIntakeDestinationMetadata(service, ensuredShipment.shipmentId);
  const portalBaseRaw = destMeta[SC_RETURN_PORTAL_BASE_URL];
  const portalBaseUrl =
    typeof portalBaseRaw === "string" && portalBaseRaw.trim().startsWith("http")
      ? portalBaseRaw.trim()
      : "";
  const bootstrapped = portalBaseUrl.length > 0;

  const { data: shipTrackingRow } = await service
    .from("shipments")
    .select("tracking_number")
    .eq("id", ensuredShipment.shipmentId)
    .maybeSingle();
  const shipmentTracking =
    typeof shipTrackingRow?.tracking_number === "string" ? shipTrackingRow.tracking_number : null;
  const keepReturnTracking = collectIntakeReturnTrackingKeepKeys(typed, shipmentTracking);
  const destOrder = String(destMeta.sendcloud_order_number ?? "").trim() || orderNumber;

  if (!params.force && keepReturnTracking.length > 0) {
    for (const r of typed) {
      const portal = readPortalFromMeta(unwrapIntake(r.item_intake)?.metadata ?? null);
      if (portal.portalUrl?.startsWith("http") && !isIntakeReturnPortalSessionExpired(portal)) {
        return {
          ok: true,
          return_portal_url: portal.portalUrl,
          order_number: portal.orderNumber ?? destOrder,
          postal_code: portal.postalCode ?? recipient.postalCode,
          item_ids: sortedIds,
        };
      }
    }
  }

  if (!params.force) {
    await pruneStaleIntakeReturnsForPortalStart(env, destOrder, keepReturnTracking);
    for (const id of sortedIds) {
      const soloOrder = buildStableMemberIntakeOrderNumber([id]);
      if (soloOrder !== destOrder) {
        await pruneStaleIntakeReturnsForPortalStart(env, soloOrder, keepReturnTracking);
      }
    }
  }

  if (params.force) {
    const cancelInput = await loadMemberIntakeSendcloudCancelInput(service, {
      itemIds: sortedIds,
      defaultOrderNumber: orderNumber,
    });
    for (const id of collectPanelShipmentIdsFromRows(typed)) {
      if (!cancelInput.panelShipmentIds.includes(id)) {
        cancelInput.panelShipmentIds.push(id);
      }
    }
    const cancelled = await cancelMemberIntakeSendcloudArtifacts(env, cancelInput);
    if (!cancelled.ok) {
      return { ok: false, error: cancelled.error, status: 502 };
    }
    await resetMemberIntakeShipmentForPortal(service, {
      itemIds: sortedIds,
      excludedReturnParcelIds: cancelled.cancelledReturnIds,
      orderNumbers: [orderNumber],
      sendcloudEnv: env,
    });
    for (const id of sortedIds) {
      await clearItemIntakeShippingLabelMetadata(service, id);
    }
  } else {
    for (const r of typed) {
      const portal = readPortalFromMeta(unwrapIntake(r.item_intake)?.metadata ?? null);
      if (portal.portalUrl?.startsWith("http")) {
        if (isIntakeReturnPortalSessionExpired(portal)) {
          return {
            ok: false,
            error: `Ton accès au portail a expiré. Appuie sur Réinitialiser pour rouvrir le portail avec ta commande.`,
            status: 410,
          };
        }
        return {
          ok: true,
          return_portal_url: portal.portalUrl,
          order_number: portal.orderNumber ?? orderNumber,
          postal_code: portal.postalCode ?? recipient.postalCode,
          item_ids: sortedIds,
        };
      }
    }
  }

  if (bootstrapped) {
    const portalUrl = buildReturnPortalUrlWithPrefill(portalBaseUrl, {
      orderNumber,
      postalCode: recipient.postalCode,
      identifier: orderNumber,
    });
    const patched = await patchIntakeReturnPortalSession(service, {
      itemIds: sortedIds,
      portalUrl,
      orderNumber,
      postalCode: recipient.postalCode,
      portalIdentifier: orderNumber,
      memberIntakeShipmentId: ensuredShipment.shipmentId,
      notes:
        "Portail retour membre — commande stable, en attente du colis retour Sendcloud.".slice(0, 2000),
    });
    if (!patched.ok) {
      return { ok: false, error: patched.error, status: patched.status };
    }
    return {
      ok: true,
      return_portal_url: portalUrl,
      order_number: orderNumber,
      postal_code: recipient.postalCode,
      item_ids: sortedIds,
    };
  }

  const senderAddressId = await resolveSendcloudSenderAddressId(env);
  if (!senderAddressId) {
    return {
      ok: false,
      error:
        "Adresse expéditeur Segna introuvable dans Sendcloud. Ajoute SENDCLOUD_SENDER_ADDRESS_ID ou une adresse expéditeur dans le panel Sendcloud.",
      status: 502,
      developerHint: SENDCLOUD_RETURN_PORTAL_ENV_HINT,
    };
  }

  const created = await createDummyOutboundShipmentForReturnPortal(env, {
    orderNumber,
    toRecipient: recipient,
    senderAddressId,
  });
  if (!created.ok) {
    const friendly = created.error.includes("does not exist")
      ? "Configuration Sendcloud à ajuster (règle d’expédition domicile ou option panel)."
      : created.error;
    console.error("[return-portal/start] dummy shipment failed", {
      itemIds: sortedIds,
      orderNumber,
      mode: "default_rules",
      error: created.error,
      sendcloudStatus: created.sendcloudStatus,
      sendcloudRaw: created.sendcloudRaw,
    });
    await recordPortalFailure(service, sortedIds, friendly);
    return {
      ok: false,
      error: friendly,
      status: 502,
      developerHint: buildReturnPortalDevHint({
        error: created.error,
        sendcloudStatus: created.sendcloudStatus,
        sendcloudRaw: created.sendcloudRaw,
        context: { orderNumber, mode: "default_rules" },
      }),
    };
  }

  const portalRaw = await fetchSendcloudReturnPortalUrl(env, created.shipmentId);
  if (!portalRaw.ok) {
    await cancelSendcloudShipment(env, created.shipmentId).catch(() => undefined);
    await recordPortalFailure(service, sortedIds, portalRaw.error);
    return { ok: false, error: portalRaw.error, status: 502, developerHint: SENDCLOUD_RETURN_PORTAL_ENV_HINT };
  }

  const dummyCancelledAt = new Date().toISOString();
  const cancelDummy = await cancelDummyOutboundAfterReturnPortalUrl(env, created);
  if (!cancelDummy.ok) {
    const msg =
      "Le portail retour est prêt mais l’annulation de l’expédition technique Sendcloud a échoué. Réessaie ou contacte le support.";
    await recordPortalFailure(service, sortedIds, cancelDummy.error);
    return { ok: false, error: msg, status: 502, developerHint: cancelDummy.error };
  }

  const postalCode = recipient.postalCode;
  const portalIdentifier = orderNumber;
  const portalUrl = buildReturnPortalUrlWithPrefill(portalRaw.url, {
    orderNumber,
    postalCode,
    identifier: portalIdentifier,
  });

  await saveMemberIntakePortalBaseUrl(
    service,
    ensuredShipment.shipmentId,
    stripReturnPortalUrlToBase(portalRaw.url),
  );

  await syncMemberIntakeShipmentPortalIds(service, {
    shipmentId: ensuredShipment.shipmentId,
    orderNumber,
    panelShipmentId: created.shipmentId,
    outboundParcelId: created.parcelId,
  });

  const notes =
    "Portail retour Sendcloud — expédition aller factice créée puis annulée (seul le retour membre compte).".slice(
      0,
      2000,
    );

  const patched = await patchIntakeReturnPortalSession(service, {
    itemIds: sortedIds,
    portalUrl,
    orderNumber,
    postalCode,
    portalIdentifier,
    memberIntakeShipmentId: ensuredShipment.shipmentId,
    notes,
    extraPatch: {
      sc_dummy_shipment_id: created.shipmentId,
      ...(created.parcelId != null ? { sc_outgoing_parcel_id: String(created.parcelId) } : {}),
      sc_dummy_shipment_cancelled_at: dummyCancelledAt,
    },
    removeKeys: ["sc_dummy_cancel_after_at"],
  });
  if (!patched.ok) {
    return { ok: false, error: patched.error, status: patched.status };
  }

  return {
    ok: true,
    return_portal_url: portalUrl,
    order_number: orderNumber,
    postal_code: postalCode,
    item_ids: sortedIds,
  };
}

export async function runMemberIntakeReturnPortalComplete(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[]; servicePointId: number },
): Promise<
  | { ok: true; label_url: string; order_number: string; item_ids: string[] }
  | { ok: false; error: string; status: number }
> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1 || sortedIds.length > MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) {
    return {
      ok: false,
      error: `Entre 1 et ${MEMBER_INTAKE_SHIPMENT_MAX_ITEMS} pièces requises.`,
      status: 400,
    };
  }
  if (!Number.isFinite(params.servicePointId) || params.servicePointId <= 0) {
    return { ok: false, error: "Point relais invalide.", status: 400 };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return { ok: false, error: "Envoi indisponible : Sendcloud non configuré.", status: 501 };
  }

  const { data: rows, error: qerr } = await service
    .from("items")
    .select("id,owner_user_id,deleted_at,item_intake(listing_stage,fulfillment_stage,metadata)")
    .in("id", sortedIds);

  if (qerr || !rows || rows.length !== sortedIds.length) {
    return { ok: false, error: "Pièce introuvable ou accès refusé.", status: 403 };
  }

  const typed = rows as unknown as ItemRow[];
  let orderNumber = "";
  let portalIdentifier = "";
  let postalCode = "";

  for (const r of typed) {
    if (r.owner_user_id !== params.userId || r.deleted_at != null) {
      return { ok: false, error: "Accès refusé.", status: 403 };
    }
    const intake = unwrapIntake(r.item_intake);
    if (
      !intake ||
      String(intake.listing_stage) !== "validated" ||
      !intakeAllowsShippingPreparation(intake.fulfillment_stage)
    ) {
      return { ok: false, error: "Pièce non en phase expédition.", status: 400 };
    }
    const portal = readPortalFromMeta(intake.metadata ?? null);
    if (!orderNumber) orderNumber = portal.orderNumber ?? "";
    if (!portalIdentifier) {
      portalIdentifier = portal.portalIdentifier ?? portal.orderNumber ?? "";
    }
    if (!postalCode) postalCode = portal.postalCode ?? "";
    if (portal.labelUrl?.startsWith("http")) {
      return {
        ok: true,
        label_url: portal.labelUrl,
        order_number: orderNumber,
        item_ids: sortedIds,
      };
    }
  }

  if (!orderNumber || !postalCode) {
    return {
      ok: false,
      error: "Prépare d’abord ton envoi (bouton ci-dessus) avant de choisir un relais.",
      status: 400,
    };
  }

  const identifier = portalIdentifier || orderNumber;
  const outgoing = await fetchReturnPortalOutgoing(env, { identifier, postalCode });
  if (!outgoing.ok) {
    return { ok: false, error: outgoing.error, status: 502 };
  }

  const reasonId = getIntakeReturnPortalReasonId();
  const incomingBody = buildReturnPortalIncomingBody({
    reasonId,
    outgoingParcel: outgoing.parcel,
    servicePointId: params.servicePointId,
    products: outgoing.products,
  });

  const created = await createReturnPortalIncoming(outgoing.accessToken, incomingBody);
  if (!created.ok) {
    await recordPortalFailure(service, sortedIds, created.error);
    return { ok: false, error: created.error, status: 502 };
  }

  const label = await pollReturnPortalLabel(created.pollerUrl, outgoing.accessToken);
  if (!label.ok) {
    await recordPortalFailure(service, sortedIds, label.error);
    return { ok: false, error: label.error, status: 502 };
  }

  const notes =
    "Retour membre Chrono 2Shop (API portail, sans étape motif) — étiquette générée.".slice(0, 2000);
  const single = sortedIds.length === 1;

  let memberIntakeShipmentId: string | null = null;
  for (const r of typed) {
    const intakeMeta = unwrapIntake(r.item_intake)?.metadata ?? null;
    const sc =
      intakeMeta && typeof intakeMeta === "object" && !Array.isArray(intakeMeta)
        ? (intakeMeta as Record<string, unknown>).sendcloud
        : null;
    const sid =
      sc && typeof sc === "object" && !Array.isArray(sc)
        ? String((sc as Record<string, unknown>)[SC_MEMBER_INTAKE_SHIPMENT_ID] ?? "").trim()
        : "";
    if (sid) {
      memberIntakeShipmentId = sid;
      break;
    }
  }

  let returnTrackingNumber: string | null = null;
  let outgoingParcelId: number | null = null;

  for (const r of typed) {
    const meta = unwrapIntake(r.item_intake)?.metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
    const sc = (meta as Record<string, unknown>).sendcloud;
    if (!sc || typeof sc !== "object" || Array.isArray(sc)) continue;
    if (!outgoingParcelId) {
      outgoingParcelId = parsePortalParcelId((sc as Record<string, unknown>).sc_outgoing_parcel_id);
    }
  }

  const incomingParcelId = created.incomingParcelIds[0] ?? null;

  if (memberIntakeShipmentId) {
    if (incomingParcelId) {
      await patchMemberIntakeShipmentReturnParcel(service, memberIntakeShipmentId, incomingParcelId);
    }
    const destMeta = await readMemberIntakeDestinationMetadata(service, memberIntakeShipmentId);
    const excludeOutgoing =
      outgoingParcelId ?? parsePortalParcelId(destMeta.sc_outgoing_parcel_id);
    returnTrackingNumber = await resolveMemberIntakeReturnTracking(env, {
      orderNumber,
      incomingParcelId,
      outgoingParcelId: excludeOutgoing,
      dummyParcelId: excludeOutgoing,
    });
    if (!returnTrackingNumber) {
      const sync = await syncMemberIntakeReturnFromSendcloudByOrder(service, env, {
        shipmentId: memberIntakeShipmentId,
        orderNumber,
        outgoingParcelId: excludeOutgoing,
        dummyParcelId: excludeOutgoing,
      });
      if (sync.ok && sync.tracking_number) {
        returnTrackingNumber = sync.tracking_number;
      }
    }
    const carrierTrackingUrl = buildCarrierTrackingUrlFromNumber(returnTrackingNumber);
    await syncMemberIntakeShipmentTracking(service, memberIntakeShipmentId, {
      trackingNumber: returnTrackingNumber,
      trackingUrl: carrierTrackingUrl,
    });
  }

  const carrierTrackingUrl = buildCarrierTrackingUrlFromNumber(returnTrackingNumber);

  for (const id of sortedIds) {
    const patchRes = await patchItemIntakeSendcloudMetadata(
      service,
      id,
      {
        label_url: label.labelUrl,
        ...(carrierTrackingUrl ? { lien_suivi: carrierTrackingUrl } : {}),
        sc_order_number: orderNumber,
        sc_return_portal_identifier: orderNumber,
        reference_expedition: orderNumber,
        ...(returnTrackingNumber ? { numero_suivi: returnTrackingNumber } : {}),
        notes_interne: notes,
        last_backoffice_update_at: new Date().toISOString(),
        ...(single ? {} : { sc_merge_item_ids: sortedIds.join(",") }),
      },
      {
        removeKeys: ["last_member_sc_error_at", "last_member_sc_error_message"],
      },
    );
    if (!patchRes.ok) {
      return { ok: false, error: patchRes.message, status: 500 };
    }
  }

  return {
    ok: true,
    label_url: label.labelUrl,
    order_number: orderNumber,
    item_ids: sortedIds,
  };
}

/** Relève le suivi retour XT (Sendcloud) sur le shipment `member_intake` en base. */
export async function runMemberIntakeReturnPortalSync(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[] },
): Promise<
  | { ok: true; synced: boolean; tracking_number?: string | null }
  | { ok: false; error: string; status: number }
> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1 || sortedIds.length > MEMBER_INTAKE_SHIPMENT_MAX_ITEMS) {
    return {
      ok: false,
      error: `Entre 1 et ${MEMBER_INTAKE_SHIPMENT_MAX_ITEMS} pièces requises.`,
      status: 400,
    };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return { ok: false, error: "Envoi indisponible : Sendcloud non configuré.", status: 501 };
  }

  const { data: rows, error: qerr } = await service
    .from("items")
    .select("id,owner_user_id,item_intake(metadata)")
    .in("id", sortedIds);

  if (qerr || !rows || rows.length !== sortedIds.length) {
    return { ok: false, error: "Pièce introuvable ou accès refusé.", status: 403 };
  }

  for (const r of rows as Array<{ owner_user_id: string }>) {
    if (r.owner_user_id !== params.userId) {
      return { ok: false, error: "Accès refusé.", status: 403 };
    }
  }

  await cancelDueIntakeDummyShipments(service, sortedIds);

  let metadataShipmentId: string | null = null;
  for (const r of rows as unknown as Array<{ item_intake?: ItemRow["item_intake"] }>) {
    const intake = unwrapIntake(r.item_intake);
    const meta = intake?.metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
    const sc = (meta as Record<string, unknown>).sendcloud;
    if (!sc || typeof sc !== "object" || Array.isArray(sc)) continue;
    const sid = String((sc as Record<string, unknown>)[SC_MEMBER_INTAKE_SHIPMENT_ID] ?? "").trim();
    if (sid) {
      metadataShipmentId = sid;
      break;
    }
  }

  const shipmentId = await resolveActiveMemberIntakeShipmentIdForItems(
    service,
    sortedIds,
    metadataShipmentId,
  );
  if (!shipmentId) {
    return { ok: true, synced: false };
  }

  if (metadataShipmentId && metadataShipmentId !== shipmentId) {
    for (const r of rows as unknown as Array<{ id: string; item_intake?: ItemRow["item_intake"] }>) {
      await patchItemIntakeSendcloudMetadata(service, String(r.id), {
        [SC_MEMBER_INTAKE_SHIPMENT_ID]: shipmentId,
      });
    }
  }

  const groupOrderNumber = buildStableMemberIntakeOrderNumber(sortedIds);
  let orderNumber = groupOrderNumber;

  const destMeta = await readMemberIntakeDestinationMetadata(service, shipmentId);
  const destOrder = String(destMeta.sendcloud_order_number ?? "").trim();
  if (destOrder) {
    orderNumber = destOrder;
  } else if (sortedIds.length === 1) {
    for (const r of rows as unknown as Array<{ item_intake?: ItemRow["item_intake"] }>) {
      const intake = unwrapIntake(r.item_intake);
      const portal = readPortalFromMeta(intake?.metadata ?? null);
      if (portal.orderNumber?.trim()) {
        orderNumber = portal.orderNumber.trim();
        break;
      }
    }
  }

  const outgoingParcelId = parsePortalParcelId(destMeta.sc_outgoing_parcel_id);

  const sync = await syncMemberIntakeReturnFromSendcloudByOrder(service, env, {
    shipmentId,
    orderNumber,
    outgoingParcelId,
    dummyParcelId: outgoingParcelId,
  });
  if (!sync.ok) {
    return { ok: false, error: sync.error, status: 502 };
  }
  return sync;
}

export async function runMemberIntakeReturnPortalReset(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[] },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  const env = getSendcloudEnv();
  if (!env) {
    return { ok: false, error: "Envoi indisponible : Sendcloud non configuré.", status: 501 };
  }

  const { data: rows } = await service
    .from("items")
    .select("id,owner_user_id,item_intake(metadata)")
    .in("id", sortedIds);

  const typed = (rows ?? []) as Array<{
    id: string;
    owner_user_id: string;
    item_intake?: ItemRow["item_intake"];
  }>;

  for (const r of typed) {
    if (String(r.owner_user_id) !== params.userId) {
      return { ok: false, error: "Accès refusé.", status: 403 };
    }
  }

  const orderNumber = buildStableMemberIntakeOrderNumber(sortedIds);

  const cancelInput = await loadMemberIntakeSendcloudCancelInput(service, {
    itemIds: sortedIds,
    defaultOrderNumber: orderNumber,
  });
  for (const id of collectPanelShipmentIdsFromRows(typed as ItemRow[])) {
    if (!cancelInput.panelShipmentIds.includes(id)) {
      cancelInput.panelShipmentIds.push(id);
    }
  }
  const cancelled = await cancelMemberIntakeSendcloudArtifacts(env, cancelInput);
  if (!cancelled.ok) {
    return { ok: false, error: cancelled.error, status: 502 };
  }

  const orderNumbers = new Set<string>([orderNumber]);
  for (const on of cancelInput.orderNumbers) {
    const trimmed = on.trim();
    if (trimmed) orderNumbers.add(trimmed);
  }
  for (const r of typed) {
    const portal = readPortalFromMeta(unwrapIntake(r.item_intake)?.metadata ?? null);
    if (portal.orderNumber?.trim()) orderNumbers.add(portal.orderNumber.trim());
    const sc = parseSendcloudFromIntakeMetadata(unwrapIntake(r.item_intake)?.metadata ?? null);
    if (sc?.reference_expedition?.trim()) orderNumbers.add(sc.reference_expedition.trim());
  }

  const excludedReturnTrackingNumbers = new Set<string>();
  for (const tn of cancelInput.trackingNumbers) {
    const key = String(tn ?? "").trim().toUpperCase();
    if (key) excludedReturnTrackingNumbers.add(key);
  }

  let memberIntakeShipmentId: string | null = null;
  for (const r of typed) {
    const intakeMeta = unwrapIntake(r.item_intake)?.metadata ?? null;
    const sc =
      intakeMeta && typeof intakeMeta === "object" && !Array.isArray(intakeMeta)
        ? (intakeMeta as Record<string, unknown>).sendcloud
        : null;
    const sid =
      sc && typeof sc === "object" && !Array.isArray(sc)
        ? String((sc as Record<string, unknown>)[SC_MEMBER_INTAKE_SHIPMENT_ID] ?? "").trim()
        : "";
    if (sid) {
      memberIntakeShipmentId = sid;
      break;
    }
  }

  const excludedReturnParcelIds = new Set<number>(cancelled.cancelledReturnIds);
  for (const pid of cancelInput.parcelIds) {
    if (Number.isFinite(pid) && pid > 0) excludedReturnParcelIds.add(pid);
  }

  if (memberIntakeShipmentId) {
    const destMeta = await readMemberIntakeDestinationMetadata(service, memberIntakeShipmentId);
    const linkedReturnParcelId = parsePortalParcelId(destMeta.sendcloud_parcel_id);
    if (linkedReturnParcelId) excludedReturnParcelIds.add(linkedReturnParcelId);
    const hasBase =
      typeof destMeta[SC_RETURN_PORTAL_BASE_URL] === "string" &&
      String(destMeta[SC_RETURN_PORTAL_BASE_URL]).trim().startsWith("http");
    if (!hasBase) {
      for (const r of typed) {
        const portal = readPortalFromMeta(unwrapIntake(r.item_intake)?.metadata ?? null);
        if (portal.portalUrl?.startsWith("http")) {
          await saveMemberIntakePortalBaseUrl(
            service,
            memberIntakeShipmentId,
            stripReturnPortalUrlToBase(portal.portalUrl),
          );
          break;
        }
      }
    }
  }

  await resetMemberIntakeShipmentForPortal(service, {
    itemIds: sortedIds,
    explicitShipmentIds: memberIntakeShipmentId ? [memberIntakeShipmentId] : [],
    excludedReturnParcelIds: [...excludedReturnParcelIds],
    excludedReturnTrackingNumbers: [...excludedReturnTrackingNumbers],
    orderNumbers: [...orderNumbers],
    sendcloudEnv: env,
  });

  for (const r of typed) {
    await clearItemIntakeShippingLabelMetadata(service, String(r.id));
  }

  return { ok: true };
}

export function parseIntakeReturnPortalFromRows(
  rows: Array<{ intake?: { metadata?: unknown } | null }>,
): {
  portalUrl: string | null;
  labelUrl: string | null;
  orderNumber: string | null;
  postalCode: string | null;
  portalReady: boolean;
  portalExpired: boolean;
  portalValidUntil: string | null;
} {
  for (const row of rows) {
    const sc = parseSendcloudFromIntakeMetadata(row.intake?.metadata ?? null);
    const raw = readPortalFromMeta(row.intake?.metadata ?? null);
    const labelUrl = raw.labelUrl ?? sc?.label_url ?? null;
    const portalUrl = raw.portalUrl ?? null;
    const orderNumber = raw.orderNumber ?? sc?.reference_expedition ?? null;
    const postalCode = raw.postalCode ?? null;
    const portalValidUntil = raw.cancelAfterAt || null;
    if (labelUrl?.startsWith("http")) {
      return {
        portalUrl,
        labelUrl,
        orderNumber,
        postalCode,
        portalReady: true,
        portalExpired: false,
        portalValidUntil,
      };
    }
    if (portalUrl?.startsWith("http")) {
      const expired = isIntakeReturnPortalSessionExpired(raw);
      return {
        portalUrl: expired ? null : portalUrl,
        labelUrl: null,
        orderNumber,
        postalCode,
        portalReady: !expired,
        portalExpired: expired,
        portalValidUntil,
      };
    }
  }
  return {
    portalUrl: null,
    labelUrl: null,
    orderNumber: null,
    postalCode: null,
    portalReady: false,
    portalExpired: false,
    portalValidUntil: null,
  };
}
