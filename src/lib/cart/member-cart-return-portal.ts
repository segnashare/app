import type { SupabaseClient } from "@supabase/supabase-js";

import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { normalizeFrenchPhoneToE164 } from "@/lib/phone/fr-mobile";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { resolveSendcloudSenderAddressId } from "@/lib/sendcloud/integrations";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";
import { cancelSendcloudOutboundParcel } from "@/lib/sendcloud/orders-api";
import {
  cancelSendcloudReturnsForOrderNumber,
  cancelSendcloudReturnsForTrackingNumbers,
} from "@/lib/sendcloud/returns-api";
import {
  buildReturnPortalUrlWithPrefill,
  cancelDummyOutboundAfterReturnPortalUrl,
  cancelSendcloudShipment,
  createDummyOutboundShipmentForReturnPortal,
  fetchSendcloudReturnPortalUrl,
  stripReturnPortalUrlToBase,
} from "@/lib/sendcloud/return-portal-shipment";
import { pickOutboundPanelShipmentIdForReturnPortal, findSendcloudParcelsByOrderNumberV3 } from "@/lib/sendcloud/shipments";
import {
  clearCartReturnDestinationPortalMeta,
  clearCartReturnProvisionMeta,
  ensureCartReturnShipmentForPortal,
  isCartReturnMemberTrackingNumber,
  resetCartReturnShipmentForPortal,
  collectCartReturnSyncOrderNumbers,
  syncCartReturnFromSendcloudByOrder,
  syncCartReturnShipmentPortalIds,
} from "@/lib/cart/cart-return-shipment";
import { cancelCartReturnSendcloudOrder } from "@/lib/cart/cancel-cart-return-sendcloud-order";
import { isCartReturnPortalTrackingNumber } from "@/lib/cart/cart-return-provision-meta";
import { isCartReturnLockedForMemberSetup, normalizeCartReturnShipmentStatus } from "@/lib/cart/cart-return-status";
import type { SendcloudOutboundRecipient } from "@/lib/sendcloud/shipments";

export const CART_RETURN_PORTAL_ENV_HINT =
  "SENDCLOUD_PUBLIC_KEY, SENDCLOUD_SECRET_KEY, SENDCLOUD_SENDER_ADDRESS_ID, portail retours activé sur Sendcloud.";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CartReturnPortalSession = {
  portalUrl: string | null;
  orderNumber: string | null;
  portalIdentifier: string | null;
  shipmentId: string | null;
  cancelAfterAt: string | null;
  cancelledAt: string | null;
  postalCode: string | null;
};

function strMeta(m: Record<string, unknown>, key: string): string {
  return typeof m[key] === "string" ? m[key].trim() : "";
}

export function readCartReturnPortalFromDestMeta(
  metadata: Record<string, unknown> | null | undefined,
): CartReturnPortalSession {
  const m = metadata && typeof metadata === "object" ? metadata : {};
  return {
    portalUrl: strMeta(m, "sc_cart_return_portal_url") || null,
    orderNumber: strMeta(m, "sendcloud_order_number") || strMeta(m, "sc_cart_return_portal_order_number") || null,
    portalIdentifier: strMeta(m, "sc_cart_return_portal_identifier") || null,
    shipmentId: strMeta(m, "sc_cart_return_dummy_shipment_id") || null,
    cancelAfterAt: strMeta(m, "sc_cart_return_dummy_cancel_after_at") || null,
    cancelledAt: strMeta(m, "sc_cart_return_dummy_shipment_cancelled_at") || null,
    postalCode: strMeta(m, "sc_cart_return_portal_postal_code") || null,
  };
}

export function isCartReturnPortalSessionExpired(portal: CartReturnPortalSession): boolean {
  if (!portal.portalUrl?.startsWith("http") && !portal.shipmentId) return false;
  if (portal.cancelledAt) return true;
  const until = portal.cancelAfterAt ? Date.parse(portal.cancelAfterAt) : NaN;
  if (Number.isFinite(until) && until <= Date.now()) return true;
  return false;
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

async function patchOutboundDestMeta(
  admin: SupabaseClient,
  destId: string,
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin
    .from("shipment_destinations")
    .update({ metadata: { ...existing, ...patch } })
    .eq("id", destId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function loadCartReturnPortalContext(
  admin: SupabaseClient,
  userId: string,
  cartId: string,
): Promise<
  | {
      ok: true;
      destId: string;
      destMeta: Record<string, unknown>;
      outboundShipmentId: string;
      outboundTrackingNumber: string | null;
      returnStatus: string;
      portal: CartReturnPortalSession;
    }
  | { ok: false; error: string; status: number }
> {
  const { data: cart } = await admin
    .from("carts")
    .select("id,user_id,status")
    .eq("id", cartId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cart) {
    return { ok: false, error: "Commande introuvable.", status: 404 };
  }
  if (userId && String((cart as { user_id?: string }).user_id) !== userId) {
    return { ok: false, error: "Commande introuvable.", status: 404 };
  }

  const { data: outShip } = await admin
    .from("shipments")
    .select("id,status,tracking_number,shipment_destinations(id,metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const outboundShipmentId = String((outShip as { id?: string } | null)?.id ?? "");
  if (!outboundShipmentId) {
    return { ok: false, error: "Expédition aller introuvable.", status: 404 };
  }

  const destEmb = (outShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const destRow = Array.isArray(destEmb) ? destEmb[0] : destEmb;
  const destId = String((destRow as { id?: string } | null)?.id ?? "");
  if (!destId) {
    return { ok: false, error: "Destination expédition introuvable.", status: 404 };
  }

  const destMeta =
    (destRow as { metadata?: unknown })?.metadata &&
    typeof (destRow as { metadata?: unknown }).metadata === "object"
      ? ((destRow as { metadata: Record<string, unknown> }).metadata as Record<string, unknown>)
      : {};

  const { data: retShip } = await admin
    .from("shipments")
    .select("status")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const returnStatus =
    normalizeCartReturnShipmentStatus((retShip as { status?: string } | null)?.status) ?? "pending";
  if (isCartReturnLockedForMemberSetup(returnStatus)) {
    return { ok: false, error: "Ce retour est déjà pris en charge.", status: 409 };
  }

  return {
    ok: true,
    destId,
    destMeta,
    outboundShipmentId,
    outboundTrackingNumber:
      typeof (outShip as { tracking_number?: string } | null)?.tracking_number === "string"
        ? (outShip as { tracking_number: string }).tracking_number.trim() || null
        : null,
    returnStatus,
    portal: readCartReturnPortalFromDestMeta(destMeta),
  };
}

/** Contexte reset : pas de blocage sur statut logistique avancé tant que le retour n’est pas clos côté Segna. */
async function loadCartReturnResetContext(
  admin: SupabaseClient,
  userId: string,
  cartId: string,
): Promise<
  | {
      ok: true;
      destId: string;
      destMeta: Record<string, unknown>;
      outboundShipmentId: string;
      returnShipmentId: string | null;
      returnTrackingNumber: string | null;
      portal: CartReturnPortalSession;
    }
  | { ok: false; error: string; status: number }
> {
  const base = await loadCartReturnPortalContext(admin, userId, cartId);
  if (base.ok) {
    const { data: retShip } = await admin
      .from("shipments")
      .select("id, tracking_number, status")
      .eq("cart_id", cartId)
      .eq("context", "cart_return")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      ok: true,
      destId: base.destId,
      destMeta: base.destMeta,
      outboundShipmentId: base.outboundShipmentId,
      returnShipmentId: retShip?.id ? String(retShip.id) : null,
      returnTrackingNumber:
        typeof retShip?.tracking_number === "string" ? retShip.tracking_number.trim() : null,
      portal: base.portal,
    };
  }

  if (base.status !== 409) {
    return base;
  }

  const { data: cart } = await admin
    .from("carts")
    .select("id,user_id")
    .eq("id", cartId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cart || String((cart as { user_id?: string }).user_id) !== userId) {
    return { ok: false, error: "Commande introuvable.", status: 404 };
  }

  const { data: outShip } = await admin
    .from("shipments")
    .select("id, shipment_destinations(id, metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const outboundShipmentId = String((outShip as { id?: string } | null)?.id ?? "");
  const destEmb = (outShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const destRow = Array.isArray(destEmb) ? destEmb[0] : destEmb;
  const destId = String((destRow as { id?: string } | null)?.id ?? "");
  if (!outboundShipmentId || !destId) {
    return { ok: false, error: "Expédition aller introuvable.", status: 404 };
  }

  const destMeta =
    destRow && typeof destRow === "object" && "metadata" in destRow && destRow.metadata && typeof destRow.metadata === "object"
      ? (destRow.metadata as Record<string, unknown>)
      : {};

  const { data: retShip } = await admin
    .from("shipments")
    .select("id, tracking_number")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    ok: true,
    destId,
    destMeta,
    outboundShipmentId,
    returnShipmentId: retShip?.id ? String(retShip.id) : null,
    returnTrackingNumber:
      typeof retShip?.tracking_number === "string" ? retShip.tracking_number.trim() : null,
    portal: readCartReturnPortalFromDestMeta(destMeta),
  };
}

async function cancelCartReturnSendcloudArtifacts(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  params: {
    orderNumber: string;
    trackingNumbers: string[];
    panelShipmentIds: string[];
    parcelIds: number[];
  },
): Promise<string[]> {
  const warnings: string[] = [];
  const panelIds = new Set(params.panelShipmentIds.map((x) => x.trim()).filter(Boolean));
  const parcelIds = new Set(params.parcelIds.filter((id) => Number.isFinite(id) && id > 0));

  for (const id of panelIds) {
    await cancelSendcloudShipment(env, id).catch(() => undefined);
  }

  for (const pid of parcelIds) {
    await cancelSendcloudOutboundParcel(env, pid).catch(() => undefined);
  }

  const on = params.orderNumber.trim();
  if (on) {
    const byOrder = await cancelSendcloudReturnsForOrderNumber(env, on);
    if (!byOrder.ok) {
      warnings.push(byOrder.error);
    }
  }

  const trackingKeys = [
    ...new Set(
      params.trackingNumbers
        .map((tn) => tn.trim())
        .filter((tn) => isCartReturnMemberTrackingNumber(tn)),
    ),
  ];
  if (trackingKeys.length > 0) {
    const byTn = await cancelSendcloudReturnsForTrackingNumbers(env, trackingKeys);
    if (!byTn.ok) {
      warnings.push(byTn.error);
    }
  }

  return warnings;
}

function buildCartOutboundOrderNumber(cartId: string, outboundShipmentId: string, destMeta: Record<string, unknown>): string {
  return (
    strMeta(destMeta, "sendcloud_order_number") ||
    buildSendcloudOrderNumber({
      cartId,
      shipmentId: outboundShipmentId,
      generation: 1,
    })
  );
}

async function resolveOutboundPanelShipmentForReturnPortal(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  params: {
    outboundDestMeta: Record<string, unknown>;
    outboundOrderNumber: string;
    outboundTrackingNumber: string | null;
  },
): Promise<string | null> {
  return pickOutboundPanelShipmentIdForReturnPortal(env, {
    outboundOrderNumber: params.outboundOrderNumber,
    outboundDestMeta: params.outboundDestMeta,
    outboundTrackingNumber: params.outboundTrackingNumber,
    excludeShipmentIds: [
      strMeta(params.outboundDestMeta, "sc_cart_return_dummy_shipment_id"),
    ].filter(Boolean),
  });
}

async function cancelKnownCartReturnDummyShipments(
  env: NonNullable<ReturnType<typeof getSendcloudEnv>>,
  shipmentIds: Array<string | null | undefined>,
): Promise<void> {
  const seen = new Set<string>();
  for (const raw of shipmentIds) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    await cancelSendcloudShipment(env, id).catch(() => undefined);
  }
}

export async function cancelDueCartReturnDummyShipments(
  admin: SupabaseClient,
  cartId: string,
): Promise<void> {
  const env = getSendcloudEnv();
  if (!env) return;

  const ctx = await loadCartReturnPortalContext(admin, "", cartId);
  if (!ctx || !ctx.ok) return;

  const { shipmentId, cancelAfterAt } = ctx.portal;
  if (!shipmentId || !cancelAfterAt) return;
  if (Date.parse(cancelAfterAt) > Date.now()) return;

  const cancelled = await cancelSendcloudShipment(env, shipmentId);
  if (cancelled.ok) {
    await patchOutboundDestMeta(admin, ctx.destId, ctx.destMeta, {
      sc_cart_return_dummy_shipment_cancelled_at: new Date().toISOString(),
    });
  }
}

export async function runCartReturnPortalStart(
  admin: SupabaseClient,
  params: { userId: string; cartId: string; force?: boolean },
): Promise<
  | { ok: true; return_portal_url: string; order_number: string; postal_code: string }
  | { ok: false; error: string; status: number; developerHint?: string }
> {
  const cartId = params.cartId.trim();
  if (!CART_ID_RE.test(cartId)) {
    return { ok: false, error: "Identifiant commande invalide.", status: 400 };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return {
      ok: false,
      error: "Retour indisponible : Sendcloud non configuré.",
      status: 501,
      developerHint: CART_RETURN_PORTAL_ENV_HINT,
    };
  }

  const ctx = await loadCartReturnPortalContext(admin, params.userId, cartId);
  if (!ctx.ok) return ctx;

  await cancelDueCartReturnDummyShipments(admin, cartId);

  const portalExpired = isCartReturnPortalSessionExpired(ctx.portal);

  if (!params.force && !portalExpired && ctx.portal.portalUrl?.startsWith("http")) {
    return {
      ok: true,
      return_portal_url: ctx.portal.portalUrl,
      order_number: ctx.portal.orderNumber ?? "",
      postal_code: ctx.portal.postalCode ?? "",
    };
  }

  if ((params.force || portalExpired) && ctx.portal.shipmentId) {
    await cancelKnownCartReturnDummyShipments(env, [ctx.portal.shipmentId]);
  }

  const { data: member } = await admin
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", params.userId)
    .maybeSingle();
  if (!member) {
    return { ok: false, error: "Profil membre introuvable.", status: 400 };
  }

  const recipient = memberAsRecipient(member as Parameters<typeof memberAsRecipient>[0]);
  if ("error" in recipient) {
    return { ok: false, error: recipient.error, status: 400 };
  }

  const senderAddressId = await resolveSendcloudSenderAddressId(env);
  if (!senderAddressId) {
    return {
      ok: false,
      error:
        "Adresse expéditeur Segna introuvable. Configure SENDCLOUD_SENDER_ADDRESS_ID ou une adresse expéditeur Sendcloud.",
      status: 502,
      developerHint: CART_RETURN_PORTAL_ENV_HINT,
    };
  }

  const orderNumber = buildCartOutboundOrderNumber(cartId, ctx.outboundShipmentId, ctx.destMeta);

  const ensuredReturn = await ensureCartReturnShipmentForPortal(admin, cartId, orderNumber);
  if (!ensuredReturn.ok) {
    return { ok: false, error: ensuredReturn.error, status: 500 };
  }

  const outboundPanelShipmentId = await resolveOutboundPanelShipmentForReturnPortal(env, {
    outboundDestMeta: ctx.destMeta,
    outboundOrderNumber: orderNumber,
    outboundTrackingNumber: ctx.outboundTrackingNumber,
  });

  let portalBaseUrl: string | null = null;
  let portalSourceShipmentId: string | null = null;
  let dummyCreated: { shipmentId: string; parcelId: number | null; trackingNumber: string | null } | null =
    null;
  let dummyCancelledAt: string | null = null;

  if (outboundPanelShipmentId) {
    const portalFromOutbound = await fetchSendcloudReturnPortalUrl(env, outboundPanelShipmentId);
    if (portalFromOutbound.ok) {
      portalBaseUrl = portalFromOutbound.url;
      portalSourceShipmentId = outboundPanelShipmentId;
      await cancelKnownCartReturnDummyShipments(env, [
        strMeta(ctx.destMeta, "sc_cart_return_dummy_shipment_id"),
        ctx.portal.shipmentId,
      ]);
    }
  }

  if (!portalBaseUrl) {
    const created = await createDummyOutboundShipmentForReturnPortal(env, {
      orderNumber,
      toRecipient: recipient,
      senderAddressId,
    });
    if (!created.ok) {
      return {
        ok: false,
        error: created.error,
        status: 502,
        developerHint: CART_RETURN_PORTAL_ENV_HINT,
      };
    }

    const portalFromDummy = await fetchSendcloudReturnPortalUrl(env, created.shipmentId);
    if (!portalFromDummy.ok) {
      await cancelSendcloudShipment(env, created.shipmentId).catch(() => undefined);
      return { ok: false, error: portalFromDummy.error, status: 502, developerHint: CART_RETURN_PORTAL_ENV_HINT };
    }

    dummyCancelledAt = new Date().toISOString();
    const cancelDummy = await cancelDummyOutboundAfterReturnPortalUrl(env, created);
    if (!cancelDummy.ok) {
      return {
        ok: false,
        error:
          "Le portail retour est prêt mais l’annulation de l’expédition technique Sendcloud a échoué. Réessaie ou contacte le support.",
        status: 502,
        developerHint: cancelDummy.error,
      };
    }

    portalBaseUrl = portalFromDummy.url;
    portalSourceShipmentId = created.shipmentId;
    dummyCreated = created;
  }

  const postalCode = recipient.postalCode;
  const portalIdentifier =
    ctx.outboundTrackingNumber?.trim() ||
    dummyCreated?.trackingNumber?.trim() ||
    orderNumber;
  const portalUrl = buildReturnPortalUrlWithPrefill(portalBaseUrl, {
    orderNumber,
    postalCode,
    identifier: portalIdentifier,
  });

  await syncCartReturnShipmentPortalIds(admin, {
    cartReturnShipmentId: ensuredReturn.shipmentId,
    cartId,
    orderNumber,
    panelShipmentId: outboundPanelShipmentId || portalSourceShipmentId || "",
    outboundParcelId:
      parsePositiveInt(ctx.destMeta.sendcloud_parcel_id) ?? dummyCreated?.parcelId ?? null,
  });

  const metaPatch: Record<string, unknown> = {
    sc_cart_return_portal_url: portalUrl,
    sc_cart_return_portal_identifier: portalIdentifier,
    sc_cart_return_portal_postal_code: postalCode,
    sc_cart_return_portal_order_number: orderNumber,
    sc_cart_return_portal_base_url: stripReturnPortalUrlToBase(portalBaseUrl),
    sc_cart_return_shipment_id: ensuredReturn.shipmentId,
    sc_cart_return_outbound_portal_shipment_id: outboundPanelShipmentId,
    sc_cart_return_dummy_shipment_cancelled_at: dummyCancelledAt,
    sc_cart_return_dummy_cancel_after_at: null,
  };
  if (outboundPanelShipmentId && !dummyCreated) {
    metaPatch.sendcloud_panel_shipment_id = outboundPanelShipmentId;
  }
  if (dummyCreated) {
    metaPatch.sc_cart_return_dummy_shipment_id = dummyCreated.shipmentId;
    if (dummyCreated.parcelId) {
      metaPatch.sc_cart_return_dummy_parcel_id = dummyCreated.parcelId;
    }
  } else {
    metaPatch.sc_cart_return_dummy_shipment_id = null;
    metaPatch.sc_cart_return_dummy_parcel_id = null;
  }

  const patched = await patchOutboundDestMeta(admin, ctx.destId, ctx.destMeta, metaPatch);
  if (!patched.ok) {
    return { ok: false, error: patched.error, status: 500 };
  }

  return {
    ok: true,
    return_portal_url: portalUrl,
    order_number: orderNumber,
    postal_code: postalCode,
  };
}

/** Relève le retour Sendcloud (colis XT) et met à jour le shipment `cart_return` en base. */
export async function runCartReturnPortalSync(
  admin: SupabaseClient,
  params: { userId: string; cartId: string },
): Promise<
  | { ok: true; synced: boolean; tracking_number?: string | null }
  | { ok: false; error: string; status: number }
> {
  const cartId = params.cartId.trim();
  if (!CART_ID_RE.test(cartId)) {
    return { ok: false, error: "Identifiant commande invalide.", status: 400 };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return { ok: false, error: "Retour indisponible : Sendcloud non configuré.", status: 501 };
  }

  const ctx = await loadCartReturnPortalContext(admin, params.userId, cartId);
  if (!ctx.ok) return ctx;

  await cancelDueCartReturnDummyShipments(admin, cartId);

  const { data: retShip } = await admin
    .from("shipments")
    .select("id")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const orderNumbers = await collectCartReturnSyncOrderNumbers(admin, {
    cartId,
    outboundShipmentId: ctx.outboundShipmentId,
    outboundDestMeta: ctx.destMeta,
    cartReturnShipmentId: retShip?.id ? String(retShip.id) : null,
  });

  const outboundParcelId = parsePositiveInt(ctx.destMeta.sendcloud_parcel_id);
  const dummyParcelId = parsePositiveInt(ctx.destMeta.sc_cart_return_dummy_parcel_id);
  const portalIdentifier =
    strMeta(ctx.destMeta, "sc_cart_return_portal_identifier") || ctx.outboundTrackingNumber;

  const sync = await syncCartReturnFromSendcloudByOrder(admin, env, {
    cartId,
    orderNumbers,
    outboundParcelId,
    dummyParcelId,
    portalIdentifier,
  });
  if (!sync.ok) {
    return { ok: false, error: sync.error, status: 502 };
  }
  return sync;
}

function parsePositiveInt(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const PORTAL_META_KEYS = [
  "sc_cart_return_portal_url",
  "sc_cart_return_portal_identifier",
  "sc_cart_return_portal_postal_code",
  "sc_cart_return_portal_order_number",
  "sc_cart_return_dummy_shipment_id",
  "sc_cart_return_dummy_cancel_after_at",
  "sc_cart_return_dummy_shipment_cancelled_at",
] as const;

export async function runCartReturnPortalReset(
  admin: SupabaseClient,
  params: { userId: string; cartId: string },
): Promise<{ ok: true; warnings?: string[] } | { ok: false; error: string; status: number }> {
  const cartId = params.cartId.trim();
  if (!CART_ID_RE.test(cartId)) {
    return { ok: false, error: "Identifiant commande invalide.", status: 400 };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return {
      ok: false,
      error: "Retour indisponible : Sendcloud non configuré.",
      status: 501,
    };
  }

  const ctx = await loadCartReturnResetContext(admin, params.userId, cartId);
  if (!ctx.ok) return ctx;

  const { data: cartRow } = await admin
    .from("carts")
    .select("sendcloud_outbound_order_number")
    .eq("id", cartId)
    .maybeSingle();

  const orderNumber =
    strMeta(ctx.destMeta, "sendcloud_order_number") ||
    strMeta(ctx.destMeta, "sc_cart_return_portal_order_number") ||
    String((cartRow as { sendcloud_outbound_order_number?: string } | null)?.sendcloud_outbound_order_number ?? "").trim() ||
    buildSendcloudOrderNumber({
      cartId,
      shipmentId: ctx.outboundShipmentId,
      generation: 1,
    });

  const parcelIds: number[] = [];
  for (const raw of [
    ctx.destMeta.sc_cart_return_sendcloud_parcel_id,
    ctx.destMeta.sc_cart_return_dummy_parcel_id,
  ]) {
    const n = parsePositiveInt(raw);
    if (n) parcelIds.push(n);
  }

  if (ctx.returnShipmentId) {
    const { data: retDest } = await admin
      .from("shipment_destinations")
      .select("metadata")
      .eq("shipment_id", ctx.returnShipmentId)
      .limit(1)
      .maybeSingle();
    const retMeta =
      retDest?.metadata && typeof retDest.metadata === "object"
        ? (retDest.metadata as Record<string, unknown>)
        : {};
    for (const raw of [
      retMeta.sendcloud_parcel_id,
      retMeta.sc_outgoing_parcel_id,
    ]) {
      const n = parsePositiveInt(raw);
      if (n) parcelIds.push(n);
    }
  }

  const panelShipmentIds = [
    ctx.portal.shipmentId,
    strMeta(ctx.destMeta, "sendcloud_panel_shipment_id"),
  ].filter((x): x is string => Boolean(x?.trim()));

  const trackingNumbers = [
    ctx.returnTrackingNumber ?? "",
    strMeta(ctx.destMeta, "sc_cart_return_portal_identifier"),
  ].filter(Boolean);

  const warnings = await cancelCartReturnSendcloudArtifacts(env, {
    orderNumber,
    trackingNumbers,
    panelShipmentIds,
    parcelIds,
  });

  await resetCartReturnShipmentForPortal(admin, cartId, env);

  if (ctx.returnShipmentId) {
    await clearCartReturnDestinationPortalMeta(admin, ctx.returnShipmentId);
  }

  const nextMeta: Record<string, unknown> = { ...ctx.destMeta };
  delete nextMeta.sc_cart_return_sendcloud_parcel_id;
  delete nextMeta.sc_cart_return_shipment_id;
  delete nextMeta.sendcloud_panel_shipment_id;
  for (const key of PORTAL_META_KEYS) {
    delete nextMeta[key];
  }
  nextMeta.sc_cart_return_dummy_shipment_cancelled_at = new Date().toISOString();

  const { error: metaErr } = await admin
    .from("shipment_destinations")
    .update({ metadata: nextMeta })
    .eq("id", ctx.destId);
  if (metaErr) {
    return { ok: false, error: metaErr.message, status: 500 };
  }

  return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
}

/** Bordereau perdu : annule la commande retour Sendcloud (BO) et ouvre le portail sur l’expédition aller. */
export async function runCartReturnProvisionedLostLabel(
  admin: SupabaseClient,
  params: { userId: string; cartId: string },
): Promise<
  | { ok: true; return_portal_url: string }
  | { ok: false; error: string; status: number }
> {
  const cartId = params.cartId.trim();
  if (!CART_ID_RE.test(cartId)) {
    return { ok: false, error: "Identifiant commande invalide.", status: 400 };
  }

  const env = getSendcloudEnv();
  if (!env) {
    return {
      ok: false,
      error: "Retour indisponible : Sendcloud non configuré.",
      status: 501,
    };
  }

  const ctx = await loadCartReturnPortalContext(admin, params.userId, cartId);
  if (!ctx.ok) return ctx;

  const { data: retShip } = await admin
    .from("shipments")
    .select("id, status, tracking_number")
    .eq("cart_id", cartId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!retShip?.id) {
    return { ok: false, error: "Aucun retour en cours pour cette commande.", status: 404 };
  }

  const returnShipmentId = String(retShip.id);
  const returnStatus = normalizeCartReturnShipmentStatus((retShip as { status?: string }).status) ?? "pending";
  if (isCartReturnLockedForMemberSetup(returnStatus)) {
    return { ok: false, error: "Ce retour est déjà pris en charge.", status: 409 };
  }

  const trackingNumber = String((retShip as { tracking_number?: string }).tracking_number ?? "").trim();
  if (isCartReturnPortalTrackingNumber(trackingNumber)) {
    return {
      ok: false,
      error: "Utilise « Réinitialiser le retour » pour rouvrir le portail.",
      status: 409,
    };
  }

  const { data: retDest } = await admin
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", returnShipmentId)
    .limit(1)
    .maybeSingle();
  const returnDestMeta =
    retDest?.metadata && typeof retDest.metadata === "object"
      ? (retDest.metadata as Record<string, unknown>)
      : {};

  await cancelCartReturnSendcloudOrder(admin, cartId);

  const returnOrderNumber = buildSendcloudOrderNumber({
    cartId,
    shipmentId: returnShipmentId,
    generation: 1,
  });
  const returnParcels = await findSendcloudParcelsByOrderNumberV3(env, returnOrderNumber);
  for (const parcel of returnParcels) {
    if (parcel.id > 0) {
      await cancelSendcloudOutboundParcel(env, parcel.id).catch(() => undefined);
    }
  }
  const returnParcelId = parsePositiveInt(returnDestMeta.sendcloud_parcel_id);
  if (returnParcelId) {
    await cancelSendcloudOutboundParcel(env, returnParcelId).catch(() => undefined);
  }

  await resetCartReturnShipmentForPortal(admin, cartId, env);
  await clearCartReturnProvisionMeta(admin, returnShipmentId);
  await clearCartReturnDestinationPortalMeta(admin, returnShipmentId);

  const portal = await runCartReturnPortalStart(admin, {
    userId: params.userId,
    cartId,
    force: true,
  });
  if (!portal.ok) {
    return { ok: false, error: portal.error, status: portal.status };
  }

  return { ok: true, return_portal_url: portal.return_portal_url };
}
