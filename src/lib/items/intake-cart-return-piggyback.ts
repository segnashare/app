import type { SupabaseClient } from "@supabase/supabase-js";

import {
  archiveMemberIntakeShipment,
  cancelMemberIntakeSendcloudArtifacts,
  loadMemberIntakeSendcloudCancelInput,
  readMemberIntakeShipmentIdFromMetadata,
  SC_MEMBER_INTAKE_SHIPMENT_ID,
} from "@/lib/items/member-intake-shipment";
import { patchItemIntakeSendcloudMetadata } from "@/lib/items/item-intake-sendcloud-patch";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";
import { createHash } from "node:crypto";
import {
  cartReturnStatusDeposited,
  INTAKE_FULFILLMENT_IN_VERIFICATION,
  INTAKE_FULFILLMENT_READY,
  INTAKE_FULFILLMENT_SHIPPING,
  intakeEligibleForPiggybackLink,
  normalizeIntakeFulfillmentStage,
} from "@/lib/items/intake-fulfillment-stages";
import { isReturnShipmentPreDeposit } from "@/lib/cart/member-return-shipment-copy";

export const SC_SHIPPING_MODE = "sc_shipping_mode";
export const SC_SHIPPING_MODE_RETURN_PORTAL = "return_portal";
export const SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK = "cart_return_piggyback";

export const SC_PIGGYBACK_CART_ID = "sc_piggyback_cart_id";
export const SC_PIGGYBACK_SHIPMENT_ID = "sc_piggyback_shipment_id";
export const SC_PIGGYBACK_CONFIRMED_AT = "sc_piggyback_confirmed_at";
/** Contrôle BO (optionnel) : pièce bien dans la pochette retour. */
export const SC_PIGGYBACK_BO_BOX_CONFIRMED_AT = "sc_piggyback_bo_box_confirmed_at";
/** Confirmation membre sur /exchange après dépôt du retour lié. */
export const SC_PIGGYBACK_MEMBER_BOX_CONFIRMED_AT = "sc_piggyback_member_box_confirmed_at";

/** Sur `shipment_destinations` du colis `cart_return`. */
export const CART_RETURN_PENDING_INTAKE_ITEM_IDS = "pending_intake_item_ids";

/** Retour emprunt pas encore déposé au relais — échange reçu (aller livré) mais pas renvoyé. */
const PIGGYBACK_ELIGIBLE_RETURN_STATUSES = new Set(["pending", "ready"]);

export type IntakePiggybackState = {
  mode: typeof SC_SHIPPING_MODE_RETURN_PORTAL | typeof SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK | null;
  cartId: string | null;
  shipmentId: string | null;
  confirmedAt: string | null;
};

export type EligibleCartReturnPiggybackTarget = {
  cartId: string;
  returnShipmentId: string;
  returnStatus: string;
  orderNumberCompact: string;
  returnHref: string;
};

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function readSendcloudBlock(metadata: unknown): Record<string, unknown> {
  if (!isPlainRecord(metadata)) return {};
  const sc = metadata.sendcloud;
  return isPlainRecord(sc) ? sc : {};
}

export function readIntakePiggybackFromMetadata(metadata: unknown): IntakePiggybackState {
  const sc = readSendcloudBlock(metadata);
  const modeRaw = typeof sc[SC_SHIPPING_MODE] === "string" ? sc[SC_SHIPPING_MODE].trim() : "";
  const mode =
    modeRaw === SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK
      ? SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK
      : modeRaw === SC_SHIPPING_MODE_RETURN_PORTAL
        ? SC_SHIPPING_MODE_RETURN_PORTAL
        : null;
  return {
    mode,
    cartId: typeof sc[SC_PIGGYBACK_CART_ID] === "string" ? sc[SC_PIGGYBACK_CART_ID].trim() || null : null,
    shipmentId:
      typeof sc[SC_PIGGYBACK_SHIPMENT_ID] === "string" ? sc[SC_PIGGYBACK_SHIPMENT_ID].trim() || null : null,
    confirmedAt:
      typeof sc[SC_PIGGYBACK_CONFIRMED_AT] === "string" ? sc[SC_PIGGYBACK_CONFIRMED_AT].trim() || null : null,
  };
}

export function isIntakeCartReturnPiggybackActive(metadata: unknown): boolean {
  const p = readIntakePiggybackFromMetadata(metadata);
  return p.mode === SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK && Boolean(p.cartId && p.confirmedAt);
}

export function isIntakePiggybackBoxConfirmed(metadata: unknown): boolean {
  return isIntakePiggybackDepositConfirmed(metadata);
}

/** Membre (ou BO) a confirmé que la pièce est bien dans la pochette retour déposée. */
export function isIntakePiggybackDepositConfirmed(metadata: unknown): boolean {
  const sc = readSendcloudBlock(metadata);
  const memberOk =
    typeof sc[SC_PIGGYBACK_MEMBER_BOX_CONFIRMED_AT] === "string" &&
    sc[SC_PIGGYBACK_MEMBER_BOX_CONFIRMED_AT].trim().length > 0;
  const boOk =
    typeof sc[SC_PIGGYBACK_BO_BOX_CONFIRMED_AT] === "string" &&
    sc[SC_PIGGYBACK_BO_BOX_CONFIRMED_AT].trim().length > 0;
  return memberOk || boOk;
}

/** Contrôle BO : la pièce mutualisée est bien dans la pochette au dépôt retour. */
function cartReturnStatusRequiresBoBoxCheck(returnStatus: string): boolean {
  return cartReturnStatusDeposited(returnStatus);
}

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function parsePendingIntakeIds(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

function serializePendingIntakeIds(ids: string[]): string {
  return [...new Set(ids.map((s) => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).join(",");
}

/**
 * Premier envoi membre → Segna : aucune autre pièce déjà expédiée ou en cours de réception.
 */
export async function memberRequiresDedicatedIntakeReturnPortal(
  service: SupabaseClient,
  userId: string,
  excludeItemIds: string[] = [],
): Promise<boolean> {
  const exclude = new Set(excludeItemIds.map((s) => s.trim()).filter(Boolean));

  const { data: rows, error } = await service
    .from("items")
    .select("id, item_intake(fulfillment_stage, metadata)")
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .limit(500);

  if (error || !rows?.length) return true;

  for (const row of rows) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id || exclude.has(id)) continue;
    const emb = (row as { item_intake?: unknown }).item_intake;
    const intake = Array.isArray(emb) ? emb[0] : emb;
    if (!intake || typeof intake !== "object") continue;
    const fs = String((intake as { fulfillment_stage?: string | null }).fulfillment_stage ?? "").toLowerCase();
    if (fs === "in_verification" || fs === "verified") return false;
    const meta = (intake as { metadata?: unknown }).metadata;
    if (isIntakeCartReturnPiggybackActive(meta)) return false;
    const sc = readSendcloudBlock(meta);
    if (
      typeof sc.label_url === "string" &&
      sc.label_url.trim().startsWith("http") &&
      readIntakePiggybackFromMetadata(meta).mode !== SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK
    ) {
      return false;
    }
    if (
      typeof sc.sc_return_portal_url === "string" &&
      sc.sc_return_portal_url.trim().startsWith("http") &&
      fs === "shipping"
    ) {
      return false;
    }
  }

  return true;
}

export type OtherIntakeShippingPeer = {
  id: string;
  title: string;
};

/** Autres pièces du membre en phase expédition (même colis Sendcloud possible). */
export async function fetchOtherIntakeShippingPeers(
  service: SupabaseClient,
  userId: string,
  excludeItemIds: string[],
): Promise<OtherIntakeShippingPeer[]> {
  const exclude = new Set(excludeItemIds.map((s) => s.trim()).filter(Boolean));
  const { data: rows, error } = await service
    .from("items")
    .select("id, title, item_intake(listing_stage, fulfillment_stage, metadata)")
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .limit(100);

  if (error || !rows?.length) return [];

  const out: OtherIntakeShippingPeer[] = [];
  for (const row of rows) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id || exclude.has(id)) continue;
    const emb = (row as { item_intake?: unknown }).item_intake;
    const intake = Array.isArray(emb) ? emb[0] : emb;
    if (!intake || typeof intake !== "object") continue;
    const ls = String((intake as { listing_stage?: string }).listing_stage ?? "").toLowerCase();
    const fs = String((intake as { fulfillment_stage?: string | null }).fulfillment_stage ?? "").toLowerCase();
    if (ls !== "validated" || !intakeEligibleForPiggybackLink(fs)) continue;
    if (isIntakeCartReturnPiggybackActive((intake as { metadata?: unknown }).metadata)) continue;
    const title =
      typeof (row as { title?: string }).title === "string" && (row as { title: string }).title.trim()
        ? (row as { title: string }).title.trim()
        : "Pièce";
    out.push({ id, title });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

export function buildIntakeMergeShippingHref(currentItemIds: string[], peerIds: string[]): string | null {
  const merged = [...new Set([...currentItemIds, ...peerIds].map((s) => s.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (merged.length < 2 || merged.length > 5) return null;
  return `/items/shipping?ids=${merged.map(encodeURIComponent).join(",")}`;
}

export async function fetchEligibleCartReturnPiggybackTargets(
  service: SupabaseClient,
  userId: string,
): Promise<EligibleCartReturnPiggybackTarget[]> {
  const { data: carts, error: cartErr } = await service
    .from("carts")
    .select("id, status")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(30);

  if (cartErr || !carts?.length) return [];

  const out: EligibleCartReturnPiggybackTarget[] = [];

  for (const cart of carts) {
    const cartId = String((cart as { id?: string }).id ?? "");
    if (!cartId) continue;

    const { data: outShip } = await service
      .from("shipments")
      .select("status")
      .eq("cart_id", cartId)
      .eq("context", "cart_outbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (String((outShip as { status?: string } | null)?.status ?? "").toLowerCase() !== "delivered") {
      continue;
    }

    const { data: retShip } = await service
      .from("shipments")
      .select("id, status")
      .eq("cart_id", cartId)
      .eq("context", "cart_return")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const returnShipmentId = String((retShip as { id?: string } | null)?.id ?? "");
    const returnStatus = String((retShip as { status?: string } | null)?.status ?? "pending").toLowerCase();

    if (!returnShipmentId) continue;
    if (!PIGGYBACK_ELIGIBLE_RETURN_STATUSES.has(returnStatus)) continue;

    out.push({
      cartId,
      returnShipmentId,
      returnStatus,
      orderNumberCompact: formatOrderNumberCompact(cartId),
      returnHref: `/exchange/retour/${encodeURIComponent(cartId)}`,
    });
  }

  return out;
}

async function patchCartReturnPendingIntakeIds(
  service: SupabaseClient,
  returnShipmentId: string,
  cartId: string,
  mutate: (current: string[]) => string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing } = await service
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", returnShipmentId)
    .limit(1)
    .maybeSingle();

  const prevMeta =
    existing?.metadata && typeof existing.metadata === "object"
      ? (existing.metadata as Record<string, unknown>)
      : {};
  const prevIds = parsePendingIntakeIds(prevMeta[CART_RETURN_PENDING_INTAKE_ITEM_IDS]);
  const nextIds = mutate(prevIds);
  const patch = { [CART_RETURN_PENDING_INTAKE_ITEM_IDS]: serializePendingIntakeIds(nextIds) };

  if (existing?.id) {
    const { error } = await service
      .from("shipment_destinations")
      .update({ metadata: { ...prevMeta, ...patch } })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { data: outShip } = await service
    .from("shipments")
    .select("shipment_destinations(destination_type, provider_point_id, line1, line2, city, postal_code, phone, metadata)")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  const outRow = (outShip as { shipment_destinations?: unknown } | null)?.shipment_destinations;
  const template = Array.isArray(outRow) ? outRow[0] : outRow;
  const t = template as
    | {
        destination_type?: string;
        provider_point_id?: string | null;
        line1?: string | null;
        line2?: string | null;
        city?: string | null;
        postal_code?: string | null;
        phone?: string | null;
        metadata?: Record<string, unknown>;
      }
    | undefined;

  const { error: insErr } = await service.from("shipment_destinations").insert({
    shipment_id: returnShipmentId,
    destination_type: t?.destination_type ?? "pickup_point",
    provider_point_id: t?.provider_point_id ?? null,
    line1: t?.line1 ?? null,
    line2: t?.line2 ?? null,
    city: t?.city ?? null,
    postal_code: t?.postal_code ?? null,
    phone: t?.phone ?? null,
    metadata: { ...(t?.metadata ?? {}), ...patch },
  });
  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true };
}

function fulfillmentStageForCartReturnStatus(
  returnStatus: string,
): typeof INTAKE_FULFILLMENT_SHIPPING | typeof INTAKE_FULFILLMENT_IN_VERIFICATION | null {
  const s = returnStatus.toLowerCase();
  if (
    s === "delivered" ||
    s === "returned" ||
    s === "en_verification" ||
    s === "return_validated" ||
    s === "closed"
  ) {
    return INTAKE_FULFILLMENT_IN_VERIFICATION;
  }
  if (cartReturnStatusDeposited(s)) {
    return INTAKE_FULFILLMENT_SHIPPING;
  }
  return null;
}

export async function syncIntakePiggybackFulfillmentFromCartReturn(
  service: SupabaseClient,
  params: { cartId: string; returnShipmentId: string; returnStatus: string },
): Promise<void> {
  const { data: dest } = await service
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", params.returnShipmentId)
    .limit(1)
    .maybeSingle();

  const meta =
    dest?.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};
  const itemIds = parsePendingIntakeIds(meta[CART_RETURN_PENDING_INTAKE_ITEM_IDS]);
  if (itemIds.length === 0) return;

  const targetStage = fulfillmentStageForCartReturnStatus(params.returnStatus);
  if (!targetStage) return;

  const now = new Date().toISOString();

  let returnTrackingPatch: Record<string, string> = {};
  if (targetStage === INTAKE_FULFILLMENT_SHIPPING) {
    const { data: ship } = await service
      .from("shipments")
      .select("tracking_number, member_tracking_url")
      .eq("id", params.returnShipmentId)
      .maybeSingle();
    const tn = String(ship?.tracking_number ?? "").trim();
    const url = String(ship?.member_tracking_url ?? "").trim();
    if (tn) returnTrackingPatch.numero_suivi = tn;
    if (url) returnTrackingPatch.lien_suivi = url;
  }

  for (const itemId of itemIds) {
    const { data: intake } = await service
      .from("item_intake")
      .select("listing_stage, fulfillment_stage, metadata")
      .eq("item_id", itemId)
      .maybeSingle();

    if (!intake || String(intake.listing_stage) !== "validated") continue;
    if (!isIntakeCartReturnPiggybackActive(intake.metadata)) continue;

    const current = normalizeIntakeFulfillmentStage(intake.fulfillment_stage);
    if (current === "verified" || current === "refused") continue;

    if (targetStage === INTAKE_FULFILLMENT_SHIPPING) {
      if (!cartReturnStatusRequiresBoBoxCheck(params.returnStatus)) continue;
      if (!isIntakePiggybackDepositConfirmed(intake.metadata)) continue;
      if (current !== INTAKE_FULFILLMENT_READY && current !== INTAKE_FULFILLMENT_SHIPPING) continue;
    } else if (targetStage === INTAKE_FULFILLMENT_IN_VERIFICATION) {
      if (current !== INTAKE_FULFILLMENT_SHIPPING && current !== INTAKE_FULFILLMENT_IN_VERIFICATION) continue;
    }

    if (current === targetStage) continue;

    await service
      .from("item_intake")
      .update({ fulfillment_stage: targetStage })
      .eq("item_id", itemId);

    await patchItemIntakeSendcloudMetadata(service, itemId, {
      ...(targetStage === INTAKE_FULFILLMENT_SHIPPING ? returnTrackingPatch : {}),
      notes_interne: `Envoi mutualisé retour commande ${params.cartId.slice(0, 8)}… — statut colis ${params.returnStatus} (${now}).`.slice(
        0,
        2000,
      ),
      last_backoffice_update_at: now,
    });
  }
}

export async function runIntakeCartReturnPiggybackConfirm(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[]; cartId: string },
): Promise<{ ok: true; cart_id: string; return_shipment_id: string } | { ok: false; error: string; status: number }> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1 || sortedIds.length > 5) {
    return { ok: false, error: "Entre 1 et 5 pièces requises.", status: 400 };
  }

  const cartId = params.cartId.trim();
  if (!cartId) {
    return { ok: false, error: "Commande invalide.", status: 400 };
  }

  const eligible = await fetchEligibleCartReturnPiggybackTargets(service, params.userId);
  const target = eligible.find((t) => t.cartId === cartId);
  if (!target) {
    return {
      ok: false,
      error: "Ce retour n’est plus éligible (déjà déposé ou clôturé). Choisis une autre commande ou le portail d’envoi.",
      status: 409,
    };
  }

  const { data: rows, error: qerr } = await service
    .from("items")
    .select("id, owner_user_id, deleted_at, item_intake(listing_stage, fulfillment_stage, metadata)")
    .in("id", sortedIds);

  if (qerr || !rows || rows.length !== sortedIds.length) {
    return { ok: false, error: "Pièce introuvable ou accès refusé.", status: 403 };
  }

  for (const r of rows) {
    if (String(r.owner_user_id) !== params.userId || r.deleted_at != null) {
      return { ok: false, error: "Accès refusé.", status: 403 };
    }
    const emb = (r as { item_intake?: unknown }).item_intake;
    const intake = Array.isArray(emb) ? emb[0] : emb;
    if (
      !intake ||
      String((intake as { listing_stage?: string }).listing_stage) !== "validated" ||
      !intakeEligibleForPiggybackLink(
        (intake as { fulfillment_stage?: string | null }).fulfillment_stage,
      )
    ) {
      return { ok: false, error: "Pièce non en phase expédition.", status: 400 };
    }
  }

  const env = getSendcloudEnv();
  if (env) {
    const shipmentKey = createHash("sha256").update(sortedIds.join("|")).digest("hex").slice(0, 16);
    const intakeOrderNumber = buildSendcloudOrderNumber({
      cartId: sortedIds[0]!,
      shipmentId: shipmentKey,
      generation: 1,
    });
    const cancelInput = await loadMemberIntakeSendcloudCancelInput(service, {
      itemIds: sortedIds,
      defaultOrderNumber: intakeOrderNumber,
    });
    const cancelled = await cancelMemberIntakeSendcloudArtifacts(env, cancelInput);
    if (!cancelled.ok) {
      return { ok: false, error: cancelled.error, status: 502 };
    }
  }

  let memberIntakeShipmentId: string | null = null;
  for (const r of rows) {
    const emb = (r as { item_intake?: unknown }).item_intake;
    const intake = Array.isArray(emb) ? emb[0] : emb;
    const meta =
      intake && typeof intake === "object" ? (intake as { metadata?: unknown }).metadata : null;
    const sid = readMemberIntakeShipmentIdFromMetadata(meta);
    if (sid) {
      memberIntakeShipmentId = sid;
      break;
    }
  }
  if (memberIntakeShipmentId) {
    await archiveMemberIntakeShipment(service, memberIntakeShipmentId);
  }

  const confirmedAt = new Date().toISOString();
  const notes =
    "Envoi mutualisé : pièce glissée dans la pochette retour d’un emprunt en cours (pas d’étiquette intake dédiée).".slice(
      0,
      2000,
    );

  for (const id of sortedIds) {
    const patchRes = await patchItemIntakeSendcloudMetadata(
      service,
      id,
      {
        [SC_SHIPPING_MODE]: SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK,
        [SC_PIGGYBACK_CART_ID]: cartId,
        [SC_PIGGYBACK_SHIPMENT_ID]: target.returnShipmentId,
        [SC_PIGGYBACK_CONFIRMED_AT]: confirmedAt,
        notes_interne: notes,
        last_backoffice_update_at: confirmedAt,
      },
      {
        removeKeys: [
          "sc_return_portal_url",
          "sc_dummy_shipment_id",
          "sc_dummy_cancel_after_at",
          "sc_dummy_shipment_cancelled_at",
          "sc_return_portal_identifier",
          "sc_return_portal_postal_code",
          "sc_outgoing_parcel_id",
          SC_MEMBER_INTAKE_SHIPMENT_ID,
          "label_url",
          "numero_suivi",
          "lien_suivi",
          "last_member_sc_error_at",
          "last_member_sc_error_message",
        ],
      },
    );
    if (!patchRes.ok) {
      return { ok: false, error: patchRes.message, status: 500 };
    }

    await service
      .from("item_intake")
      .update({ fulfillment_stage: INTAKE_FULFILLMENT_READY })
      .eq("item_id", id);
  }

  const pendingRes = await patchCartReturnPendingIntakeIds(
    service,
    target.returnShipmentId,
    cartId,
    (current) => [...new Set([...current, ...sortedIds])],
  );
  if (!pendingRes.ok) {
    return { ok: false, error: pendingRes.error, status: 500 };
  }

  return { ok: true, cart_id: cartId, return_shipment_id: target.returnShipmentId };
}

export async function runIntakeCartReturnPiggybackRevertToPortal(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[] },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1) {
    return { ok: false, error: "item_ids requis", status: 400 };
  }

  const { data: rows } = await service
    .from("items")
    .select("id, owner_user_id, item_intake(metadata)")
    .in("id", sortedIds);

  for (const r of rows ?? []) {
    if (String(r.owner_user_id) !== params.userId) {
      return { ok: false, error: "Accès refusé.", status: 403 };
    }
    const emb = (r as { item_intake?: unknown }).item_intake;
    const intake = Array.isArray(emb) ? emb[0] : emb;
    const piggy = readIntakePiggybackFromMetadata(
      intake && typeof intake === "object" ? (intake as { metadata?: unknown }).metadata : null,
    );
    if (piggy.shipmentId && piggy.cartId) {
      await patchCartReturnPendingIntakeIds(service, piggy.shipmentId, piggy.cartId, (current) =>
        current.filter((id) => !sortedIds.includes(id)),
      );
    }
    await patchItemIntakeSendcloudMetadata(
      service,
      String(r.id),
      { [SC_SHIPPING_MODE]: SC_SHIPPING_MODE_RETURN_PORTAL },
      {
        removeKeys: [
          SC_PIGGYBACK_CART_ID,
          SC_PIGGYBACK_SHIPMENT_ID,
          SC_PIGGYBACK_CONFIRMED_AT,
          SC_PIGGYBACK_BO_BOX_CONFIRMED_AT,
          SC_PIGGYBACK_MEMBER_BOX_CONFIRMED_AT,
        ],
      },
    );
  }

  return { ok: true };
}

export type MemberPiggybackDepositPrompt = {
  return_shipment_id: string;
  cart_id: string;
  order_number_compact: string;
  return_status: string;
  return_href: string;
  items: IntakePiggybackBoxCheckItem[];
};

/** File d’attente membre : retours déposés, pièces mutualisées non encore confirmées. */
export async function fetchMemberPiggybackDepositConfirmQueue(
  service: SupabaseClient,
  userId: string,
): Promise<MemberPiggybackDepositPrompt[]> {
  const { data: rows } = await service
    .from("items")
    .select("id, title, item_intake(metadata)")
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .limit(200);

  const byReturn = new Map<
    string,
    { cartId: string; itemIds: string[]; titles: Map<string, string | null> }
  >();

  for (const row of rows ?? []) {
    const itemId = String((row as { id?: string }).id ?? "");
    if (!itemId) continue;
    const emb = (row as { item_intake?: unknown }).item_intake;
    const intake = Array.isArray(emb) ? emb[0] : emb;
    const meta = intake && typeof intake === "object" ? (intake as { metadata?: unknown }).metadata : null;
    if (!isIntakeCartReturnPiggybackActive(meta)) continue;
    if (isIntakePiggybackDepositConfirmed(meta)) continue;

    const piggy = readIntakePiggybackFromMetadata(meta);
    if (!piggy.shipmentId || !piggy.cartId) continue;

    const title =
      typeof (row as { title?: string }).title === "string" && (row as { title: string }).title.trim()
        ? (row as { title: string }).title.trim()
        : null;

    const prev = byReturn.get(piggy.shipmentId) ?? {
      cartId: piggy.cartId,
      itemIds: [],
      titles: new Map<string, string | null>(),
    };
    if (!prev.itemIds.includes(itemId)) prev.itemIds.push(itemId);
    prev.titles.set(itemId, title);
    byReturn.set(piggy.shipmentId, prev);
  }

  const out: MemberPiggybackDepositPrompt[] = [];

  for (const [returnShipmentId, group] of byReturn) {
    const ctx = await fetchIntakePiggybackAwaitingBoxCheck(service, returnShipmentId);
    if (!ctx || ctx.user_id !== userId) continue;

    const items = group.itemIds
      .map((id) => ({
        item_id: id,
        title: group.titles.get(id) ?? null,
        image_url: null,
      }))
      .filter((it) => ctx.items.some((c) => c.item_id === it.item_id));

    if (items.length === 0) continue;

    out.push({
      return_shipment_id: returnShipmentId,
      cart_id: group.cartId,
      order_number_compact: formatOrderNumberCompact(group.cartId),
      return_status: ctx.return_status,
      return_href: `/exchange/retour/${encodeURIComponent(group.cartId)}`,
      items,
    });
  }

  return out.sort((a, b) => a.order_number_compact.localeCompare(b.order_number_compact));
}

export async function runMemberIntakePiggybackDepositDecisions(
  service: SupabaseClient,
  params: {
    userId: string;
    returnShipmentId: string;
    decisions: Array<{ item_id: string; in_box: boolean }>;
  },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const ctx = await fetchIntakePiggybackAwaitingBoxCheck(service, params.returnShipmentId);
  if (!ctx || ctx.user_id !== params.userId) {
    return { ok: false, error: "Retour introuvable ou accès refusé.", status: 404 };
  }

  const awaitingIds = new Set(ctx.items.map((i) => i.item_id));
  const now = new Date().toISOString();

  for (const d of params.decisions) {
    const itemId = String(d.item_id ?? "").trim();
    if (!itemId || !awaitingIds.has(itemId)) {
      return { ok: false, error: "Décision invalide.", status: 400 };
    }
  }

  if (params.decisions.length < 1) {
    return { ok: false, error: "Réponse requise.", status: 400 };
  }

  for (const d of params.decisions) {
    const itemId = d.item_id.trim();
    if (d.in_box) {
      const patchRes = await patchItemIntakeSendcloudMetadata(service, itemId, {
        [SC_PIGGYBACK_MEMBER_BOX_CONFIRMED_AT]: now,
        notes_interne: `Membre : pièce confirmée dans la pochette retour (échange ${ctx.cart_id.slice(0, 8)}…).`.slice(
          0,
          2000,
        ),
        last_backoffice_update_at: now,
      });
      if (!patchRes.ok) {
        return { ok: false, error: patchRes.message, status: 500 };
      }
      await syncSingleIntakePiggybackFulfillment(service, {
        cartId: ctx.cart_id,
        itemId,
        returnStatus: ctx.return_status,
      });
    } else {
      const revert = await runIntakeCartReturnPiggybackRevertToPortal(service, {
        userId: params.userId,
        itemIds: [itemId],
      });
      if (!revert.ok) {
        return { ok: false, error: revert.error, status: revert.status };
      }
    }
  }

  return { ok: true };
}

export type IntakeShippingOptionsSnapshot = {
  shipping_mode: IntakePiggybackState["mode"];
  piggyback: {
    cart_id: string;
    return_shipment_id: string;
    order_number_compact: string;
    return_status: string;
    return_href: string;
    pre_deposit: boolean;
  } | null;
  /** Échanges confirmés, colis reçu, retour pas encore déposé. */
  eligible_cart_returns: EligibleCartReturnPiggybackTarget[];
  other_intake_shipping_peers: OtherIntakeShippingPeer[];
  merge_intake_shipping_href: string | null;
};

export async function fetchIntakeShippingOptions(
  service: SupabaseClient,
  userId: string,
  itemIds: string[],
): Promise<IntakeShippingOptionsSnapshot> {
  const sortedIds = [...new Set(itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  const [eligible, peers] = await Promise.all([
    fetchEligibleCartReturnPiggybackTargets(service, userId),
    fetchOtherIntakeShippingPeers(service, userId, sortedIds),
  ]);
  const mergeHref = buildIntakeMergeShippingHref(
    sortedIds,
    peers.map((p) => p.id),
  );

  let shippingMode: IntakePiggybackState["mode"] = null;
  let piggyback: IntakeShippingOptionsSnapshot["piggyback"] = null;

  if (sortedIds.length > 0) {
    const { data: row } = await service
      .from("item_intake")
      .select("metadata")
      .eq("item_id", sortedIds[0]!)
      .maybeSingle();
    const state = readIntakePiggybackFromMetadata(row?.metadata ?? null);
    shippingMode = state.mode;
    if (state.mode === SC_SHIPPING_MODE_CART_RETURN_PIGGYBACK && state.cartId && state.shipmentId) {
      const match = eligible.find((t) => t.cartId === state.cartId) ?? {
        cartId: state.cartId,
        returnShipmentId: state.shipmentId,
        returnStatus: "pending",
        orderNumberCompact: formatOrderNumberCompact(state.cartId),
        returnHref: `/exchange/retour/${encodeURIComponent(state.cartId)}`,
      };
      piggyback = {
        cart_id: state.cartId,
        return_shipment_id: state.shipmentId,
        order_number_compact: match.orderNumberCompact,
        return_status: match.returnStatus,
        return_href: match.returnHref,
        pre_deposit: isReturnShipmentPreDeposit(match.returnStatus),
      };
    }
  }

  return {
    shipping_mode: shippingMode,
    piggyback,
    eligible_cart_returns: eligible,
    other_intake_shipping_peers: peers,
    merge_intake_shipping_href: mergeHref,
  };
}

export type IntakePiggybackBoxCheckItem = {
  item_id: string;
  title: string | null;
  image_url: string | null;
};

export type IntakePiggybackBoxCheckContext = {
  return_shipment_id: string;
  cart_id: string;
  user_id: string;
  return_status: string;
  items: IntakePiggybackBoxCheckItem[];
};

export async function fetchIntakePiggybackAwaitingBoxCheck(
  service: SupabaseClient,
  returnShipmentId: string,
): Promise<IntakePiggybackBoxCheckContext | null> {
  const { data: ship } = await service
    .from("shipments")
    .select("id, cart_id, status, carts(user_id)")
    .eq("id", returnShipmentId)
    .eq("context", "cart_return")
    .is("deleted_at", null)
    .maybeSingle();

  if (!ship?.cart_id) return null;
  const cartEmb = (ship as { carts?: unknown }).carts;
  const cart = Array.isArray(cartEmb) ? cartEmb[0] : cartEmb;
  const userId =
    cart && typeof cart === "object" ? String((cart as { user_id?: string }).user_id ?? "") : "";
  if (!userId) return null;

  const { data: dest } = await service
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", returnShipmentId)
    .limit(1)
    .maybeSingle();

  const meta =
    dest?.metadata && typeof dest.metadata === "object"
      ? (dest.metadata as Record<string, unknown>)
      : {};
  const returnStatus = String(ship.status ?? "pending");
  if (!cartReturnStatusDeposited(returnStatus)) return null;

  let pendingIds = parsePendingIntakeIds(meta[CART_RETURN_PENDING_INTAKE_ITEM_IDS]);

  if (pendingIds.length === 0) {
    const { data: linkedRows } = await service
      .from("items")
      .select("id, item_intake(metadata)")
      .eq("owner_user_id", userId)
      .is("deleted_at", null)
      .limit(200);
    for (const row of linkedRows ?? []) {
      const id = String((row as { id?: string }).id ?? "");
      if (!id) continue;
      const emb = (row as { item_intake?: unknown }).item_intake;
      const intake = Array.isArray(emb) ? emb[0] : emb;
      const piggy = readIntakePiggybackFromMetadata(
        intake && typeof intake === "object" ? (intake as { metadata?: unknown }).metadata : null,
      );
      if (piggy.shipmentId === returnShipmentId && piggy.cartId === String(ship.cart_id)) {
        pendingIds.push(id);
      }
    }
    pendingIds = [...new Set(pendingIds)];
    if (pendingIds.length > 0) {
      await patchCartReturnPendingIntakeIds(service, returnShipmentId, String(ship.cart_id), () => pendingIds);
    }
  }

  if (pendingIds.length === 0) return null;

  const { data: intakeRows } = await service
    .from("item_intake")
    .select("item_id, metadata, items(title)")
    .in("item_id", pendingIds);

  const awaiting: IntakePiggybackBoxCheckItem[] = [];
  for (const row of intakeRows ?? []) {
    const itemId = String((row as { item_id?: string }).item_id ?? "");
    if (!itemId) continue;
    const intakeMeta = (row as { metadata?: unknown }).metadata;
    if (!isIntakeCartReturnPiggybackActive(intakeMeta)) continue;
    if (isIntakePiggybackDepositConfirmed(intakeMeta)) continue;

    const emb = (row as { items?: unknown }).items;
    const item = Array.isArray(emb) ? emb[0] : emb;
    const title =
      item && typeof item === "object" ? String((item as { title?: string | null }).title ?? "") || null : null;

    awaiting.push({ item_id: itemId, title, image_url: null });
  }

  if (awaiting.length === 0) return null;

  return {
    return_shipment_id: returnShipmentId,
    cart_id: String(ship.cart_id),
    user_id: userId,
    return_status: returnStatus,
    items: awaiting,
  };
}

export async function hasIntakePiggybackAwaitingBoxCheck(
  service: SupabaseClient,
  returnShipmentId: string,
): Promise<boolean> {
  const ctx = await fetchIntakePiggybackAwaitingBoxCheck(service, returnShipmentId);
  return ctx != null && ctx.items.length > 0;
}

async function syncSingleIntakePiggybackFulfillment(
  service: SupabaseClient,
  params: { cartId: string; itemId: string; returnStatus: string },
): Promise<void> {
  const targetStage = fulfillmentStageForCartReturnStatus(params.returnStatus);
  if (!targetStage || targetStage !== INTAKE_FULFILLMENT_SHIPPING) return;

  const now = new Date().toISOString();

  const { data: intake } = await service
    .from("item_intake")
    .select("listing_stage, fulfillment_stage, metadata")
    .eq("item_id", params.itemId)
    .maybeSingle();

  if (!intake || String(intake.listing_stage) !== "validated") return;
  if (!isIntakeCartReturnPiggybackActive(intake.metadata)) return;
  if (!isIntakePiggybackDepositConfirmed(intake.metadata)) return;

  const current = normalizeIntakeFulfillmentStage(intake.fulfillment_stage);
  if (current === "verified" || current === "refused" || current === targetStage) return;
  if (current !== INTAKE_FULFILLMENT_READY && current !== INTAKE_FULFILLMENT_SHIPPING) return;

  await service.from("item_intake").update({ fulfillment_stage: targetStage }).eq("item_id", params.itemId);

  const piggy = readIntakePiggybackFromMetadata(intake.metadata);
  const trackingPatch: Record<string, string> = {};
  if (piggy.shipmentId) {
    const { data: ship } = await service
      .from("shipments")
      .select("tracking_number, member_tracking_url")
      .eq("id", piggy.shipmentId)
      .maybeSingle();
    const tn = String(ship?.tracking_number ?? "").trim();
    const url = String(ship?.member_tracking_url ?? "").trim();
    if (tn) trackingPatch.numero_suivi = tn;
    if (url) trackingPatch.lien_suivi = url;
  }

  await patchItemIntakeSendcloudMetadata(service, params.itemId, {
    ...trackingPatch,
    notes_interne: `Mutualisation retour ${params.cartId.slice(0, 8)}… — pièce confirmée en pochette, colis ${params.returnStatus} (${now}).`.slice(
      0,
      2000,
    ),
    last_backoffice_update_at: now,
  });
}

export async function runBoIntakePiggybackBoxDecisions(
  service: SupabaseClient,
  params: {
    returnShipmentId: string;
    actorUserId: string;
    decisions: Array<{ item_id: string; in_box: boolean }>;
  },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const ctx = await fetchIntakePiggybackAwaitingBoxCheck(service, params.returnShipmentId);
  if (!ctx) {
    return { ok: false, error: "Aucune pièce intake en attente de contrôle pour ce retour.", status: 404 };
  }

  const awaitingIds = new Set(ctx.items.map((i) => i.item_id));
  const now = new Date().toISOString();

  for (const d of params.decisions) {
    const itemId = String(d.item_id ?? "").trim();
    if (!itemId || !awaitingIds.has(itemId)) {
      return {
        ok: false,
        error: `Décision invalide ou déjà traitée pour la pièce ${itemId.slice(0, 8)}.`,
        status: 400,
      };
    }
  }

  if (params.decisions.length !== awaitingIds.size) {
    return {
      ok: false,
      error: `Réponds pour chaque pièce en attente (${awaitingIds.size} attendue${awaitingIds.size > 1 ? "s" : ""}).`,
      status: 400,
    };
  }

  for (const d of params.decisions) {
    const itemId = d.item_id.trim();
    if (d.in_box) {
      const patchRes = await patchItemIntakeSendcloudMetadata(service, itemId, {
        [SC_PIGGYBACK_BO_BOX_CONFIRMED_AT]: now,
        notes_interne: `BO : pièce confirmée dans la pochette retour (commande ${ctx.cart_id.slice(0, 8)}…).`.slice(
          0,
          2000,
        ),
        last_backoffice_update_at: now,
      });
      if (!patchRes.ok) {
        return { ok: false, error: patchRes.message, status: 500 };
      }
      await syncSingleIntakePiggybackFulfillment(service, {
        cartId: ctx.cart_id,
        itemId,
        returnStatus: ctx.return_status,
      });
    } else {
      const revert = await runIntakeCartReturnPiggybackRevertToPortal(service, {
        userId: ctx.user_id,
        itemIds: [itemId],
      });
      if (!revert.ok) {
        return { ok: false, error: revert.error, status: revert.status };
      }
      await patchItemIntakeSendcloudMetadata(service, itemId, {
        notes_interne:
          `BO : pièce absente de la pochette retour — envoi intake réinitialisé (portail / autre échange).`.slice(
            0,
            2000,
          ),
        last_backoffice_update_at: now,
      });
    }
  }

  return { ok: true };
}
