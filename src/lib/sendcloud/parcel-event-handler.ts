import type { SupabaseClient } from "@supabase/supabase-js";

import {
  findShipmentBySendcloudParcelIdExtended,
  resolveShipmentForSendcloudWebhook,
} from "@/lib/sendcloud/cart-return-sendcloud-webhook";
import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { fetchSendcloudParcel } from "@/lib/sendcloud/parcel-sync";
import {
  extractSendcloudOrderNumber,
  extractSendcloudParcelId,
  extractSendcloudStatus,
  extractSendcloudTracking,
  type SendcloudWebhookPayload,
} from "@/lib/sendcloud/sendcloud-webhook-payload";
import {
  patchCartReturnShipmentReturnParcel,
  syncCartReturnShipmentTracking,
} from "@/lib/cart/cart-return-shipment";
import { isIntakeMemberReturnTrackingNumber } from "@/lib/items/intake-shipping-metadata";
import {
  patchMemberIntakeShipmentReturnParcel,
  readMemberIntakeDestinationMetadata,
  syncMemberIntakeShipmentTracking,
} from "@/lib/items/member-intake-shipment";
import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";

export type { SendcloudWebhookPayload };
export {
  extractSendcloudOrderNumber,
  extractSendcloudParcelId,
  extractSendcloudStatus,
  extractSendcloudTracking,
} from "@/lib/sendcloud/sendcloud-webhook-payload";

type JsonRecord = SendcloudWebhookPayload;

export type ShipmentStatusTarget =
  | "dropped_in"
  | "dropped_out"
  | "in_transit_in"
  | "in_transit_out"
  | "delivered"
  | "returned"
  | "en_verification"
  | "failed";

const OUTBOUND_FORWARD: ShipmentStatusTarget[] = [
  "dropped_in",
  "in_transit_in",
  "dropped_out",
  "delivered",
];

/** Aller panier domicile : pas d’étape `dropped_out` (réservée au relais). */
const OUTBOUND_HOME_FORWARD: ShipmentStatusTarget[] = ["dropped_in", "in_transit_in", "delivered"];

const RETURN_FORWARD: ShipmentStatusTarget[] = [
  "dropped_out",
  "dropped_in",
  "in_transit_out",
  "returned",
  "en_verification",
];

/** Retour intake membre → Segna : pas d’étape `dropped_in` (dépôt relais puis transit). */
const MEMBER_INTAKE_RETURN_FORWARD: ShipmentStatusTarget[] = [
  "dropped_out",
  "in_transit_out",
  "returned",
  "en_verification",
];

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

/** `cart_outbound` : synchro Sendcloud uniquement après passage BO en `ready` (mise en colis). */
export function cartOutboundAllowsSendcloudWebhookSync(status: string): boolean {
  const st = norm(status);
  if (st === "pending") return false;
  if (st === "canceled" || st === "closed" || st === "archived") return false;
  return true;
}

export type MapSendcloudParcelOptions = {
  /** Aller panier livré à domicile (pas de point relais). */
  cartOutboundHome?: boolean;
};

function cartOutboundSendcloudIndicatesTransit(msg: string, statusId: number): boolean {
  return (
    msg.includes("transit") ||
    msg.includes("en route") ||
    msg.includes("expédié") ||
    msg.includes("expedie") ||
    msg.includes("shipped") ||
    msg.includes("picked up") ||
    msg.includes("accepted by carrier") ||
    msg === "accepted" ||
    msg.includes("sorting") ||
    msg.includes("sorted") ||
    msg.includes("announced") ||
    msg.includes("collected") ||
    msg.includes("processing") ||
    msg.includes("prise en charge") ||
    msg.includes("logistique") ||
    statusId === 3 ||
    statusId === 4 ||
    statusId === 5 ||
    statusId === 12 ||
    statusId === 13
  );
}

function cartOutboundSendcloudIndicatesRelayPickupReady(msg: string, statusId: number): boolean {
  if (cartOutboundSendcloudIndicatesTransit(msg, statusId)) return false;
  return (
    msg.includes("awaiting pickup") ||
    msg.includes("ready for pickup") ||
    msg.includes("available for pickup") ||
    msg.includes("ready to pick up") ||
    msg.includes("ready for collection") ||
    msg.includes("parcel is ready for collection") ||
    (msg.includes("prêt") && msg.includes("retrait")) ||
    (msg.includes("pret") && msg.includes("retrait")) ||
    statusId === 91 ||
    statusId === 745
  );
}

export function mapSendcloudParcelToShipmentTarget(
  context: string,
  statusMessage: string,
  statusId: number,
  options?: MapSendcloudParcelOptions,
): ShipmentStatusTarget | null {
  const msg = statusMessage.toLowerCase();
  const ctx = context.trim().toLowerCase();

  if (statusId === 2000 || msg.includes("cancel")) return "failed";

  if (ctx === "cart_outbound") {
    const home = options?.cartOutboundHome === true;
    if (
      (msg.includes("delivered") && !msg.includes("sorting") && !msg.includes("centre")) ||
      statusId === 11 ||
      statusId === 80 ||
      statusId === 639
    ) {
      return "delivered";
    }
    if (!home && cartOutboundSendcloudIndicatesRelayPickupReady(msg, statusId)) {
      return "dropped_out";
    }
    if (cartOutboundSendcloudIndicatesTransit(msg, statusId)) {
      return home ? "in_transit_in" : "dropped_in";
    }
    return null;
  }

  if (ctx === "member_intake") {
    if (
      (msg.includes("delivered") && !msg.includes("to sorting")) ||
      msg.includes("returned to sender") ||
      msg.includes("returned to merchant") ||
      statusId === 11 ||
      statusId === 80 ||
      statusId === 639
    ) {
      return "returned";
    }
    if (
      msg.includes("transit") ||
      msg.includes("en route") ||
      msg.includes("picked up by driver") ||
      msg.includes("shipment on route") ||
      msg.includes("driver on route") ||
      msg.includes("accepted by carrier") ||
      msg === "accepted" ||
      msg.includes("parcel accepted") ||
      msg.includes("accepted by the carrier") ||
      msg.includes("sorting centre") ||
      msg.includes("sorting center") ||
      msg.includes("sorted") ||
      msg.includes("to sorting") ||
      statusId === 3 ||
      statusId === 4 ||
      statusId === 5 ||
      statusId === 12 ||
      statusId === 13
    ) {
      return "in_transit_out";
    }
    if (
      msg.includes("service point") ||
      msg.includes("dropped off") ||
      msg.includes("collected by") ||
      (msg.includes("collected") && !msg.includes("awaiting")) ||
      statusId === 8
    ) {
      return "dropped_out";
    }
    return null;
  }

  if (ctx === "cart_return") {
    if (
      (msg.includes("delivered") && !msg.includes("to sorting")) ||
      msg.includes("returned to sender") ||
      msg.includes("returned to merchant") ||
      statusId === 11 ||
      statusId === 80 ||
      statusId === 639
    ) {
      return "returned";
    }
    if (
      msg.includes("accepted by carrier") ||
      msg === "accepted" ||
      msg.includes("parcel accepted") ||
      msg.includes("accepted by the carrier") ||
      statusId === 3
    ) {
      return "dropped_in";
    }
    if (
      msg.includes("transit") ||
      msg.includes("en route") ||
      msg.includes("picked up by driver") ||
      msg.includes("shipment on route") ||
      msg.includes("driver on route") ||
      statusId === 4 ||
      statusId === 5
    ) {
      return "in_transit_out";
    }
    if (
      msg.includes("sorting centre") ||
      msg.includes("sorting center") ||
      msg.includes("sorted") ||
      msg.includes("to sorting") ||
      statusId === 12 ||
      statusId === 13
    ) {
      return "dropped_in";
    }
    if (
      msg.includes("service point") ||
      msg.includes("dropped off") ||
      msg.includes("collected by") ||
      (msg.includes("collected") && !msg.includes("awaiting")) ||
      msg.includes("picked up by driver") ||
      statusId === 8
    ) {
      return "dropped_out";
    }
    return null;
  }

  return null;
}

function rankForward(chain: ShipmentStatusTarget[], status: string): number {
  const s = norm(status);
  const idx = chain.indexOf(s as ShipmentStatusTarget);
  return idx >= 0 ? idx : -1;
}

function buildForwardChain(
  context: string,
  current: string,
  target: ShipmentStatusTarget,
  options?: MapSendcloudParcelOptions,
): ShipmentStatusTarget[] {
  const chain =
    context === "member_intake"
      ? MEMBER_INTAKE_RETURN_FORWARD
      : context === "cart_return"
        ? RETURN_FORWARD
        : options?.cartOutboundHome
          ? OUTBOUND_HOME_FORWARD
          : OUTBOUND_FORWARD;
  const curRank = rankForward(chain, current);
  const targetRank = chain.indexOf(target);
  if (targetRank < 0) return [];
  if (curRank < 0) return [target];
  if (targetRank <= curRank) return [];
  return chain.slice(curRank + 1, targetRank + 1);
}

export async function findShipmentBySendcloudParcelId(
  admin: SupabaseClient,
  parcelId: number,
): Promise<{
  id: string;
  status: string;
  context: string;
  tracking_number: string | null;
  member_tracking_url: string | null;
} | null> {
  return findShipmentBySendcloudParcelIdExtended(admin, parcelId);
}

export async function findShipmentBySendcloudOrderNumber(
  admin: SupabaseClient,
  orderNumber: string,
): Promise<{
  id: string;
  status: string;
  context: string;
  tracking_number: string | null;
  member_tracking_url: string | null;
} | null> {
  const on = orderNumber.trim();
  if (!on) return null;

  const { data: cart } = await admin
    .from("carts")
    .select("id")
    .eq("sendcloud_outbound_order_number", on)
    .is("deleted_at", null)
    .maybeSingle();

  if (cart?.id) {
    const { data: ship } = await admin
      .from("shipments")
      .select("id, status, context, tracking_number, member_tracking_url")
      .eq("cart_id", cart.id)
      .eq("context", "cart_outbound")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ship?.id) {
      return ship as {
        id: string;
        status: string;
        context: string;
        tracking_number: string | null;
        member_tracking_url: string | null;
      };
    }
  }

  const { data: destRows, error: destErr } = await admin
    .from("shipment_destinations")
    .select("shipment_id")
    .eq("metadata->>sendcloud_order_number", on)
    .limit(5);

  if (destErr || !destRows?.length) return null;

  const shipmentIds = [...new Set(destRows.map((r) => String((r as { shipment_id: string }).shipment_id)))];
  const { data: ships, error: shipErr } = await admin
    .from("shipments")
    .select("id, status, context, tracking_number, member_tracking_url")
    .in("id", shipmentIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (shipErr || !ships?.length) return null;
  return ships[0] as {
    id: string;
    status: string;
    context: string;
    tracking_number: string | null;
    member_tracking_url: string | null;
  };
}

async function loadCartOutboundHomeDelivery(
  admin: SupabaseClient,
  shipmentId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("shipment_destinations")
    .select("destination_type, provider_point_id, line1")
    .eq("shipment_id", shipmentId)
    .limit(1)
    .maybeSingle();

  if (!data) return false;
  const row = data as { destination_type?: string; provider_point_id?: string | null; line1?: string | null };
  const destinationType = norm(row.destination_type);
  if (destinationType === "home") return true;
  if (destinationType === "pickup_point") return false;
  const relayId = String(row.provider_point_id ?? "").trim();
  if (relayId) return false;
  return String(row.line1 ?? "").trim().length > 0;
}

export async function processSendcloudParcelEvent(
  admin: SupabaseClient,
  env: SendcloudEnv | null,
  payload: JsonRecord,
  options?: { source?: string },
): Promise<
  | { ok: true; ignored: string }
  | {
      ok: true;
      shipment_id: string;
      parcel_id: number | null;
      status: string;
      transitions: string[];
      provisioned?: boolean;
    }
  | { ok: false; error: string }
> {
  const parcelId = extractSendcloudParcelId(payload);
  let { statusId, statusMessage } = extractSendcloudStatus(payload);
  let { trackingNumber, trackingUrl } = extractSendcloudTracking(payload);

  if ((!statusMessage || !parcelId) && env && parcelId) {
    const snap = await fetchSendcloudParcel(env, parcelId);
    if (snap) {
      statusId = snap.statusId;
      statusMessage = snap.statusMessage;
      if (!trackingNumber && snap.trackingNumber) trackingNumber = snap.trackingNumber;
      if (!trackingUrl && snap.trackingUrl) trackingUrl = snap.trackingUrl;
    }
  }

  const resolved = await resolveShipmentForSendcloudWebhook(admin, env, payload, {
    source: options?.source?.trim() || "sendcloud_webhook",
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }
  if ("notFound" in resolved && resolved.notFound) {
    return { ok: true, ignored: parcelId ? "shipment_not_found" : "parcel_id_missing" };
  }
  if (!("shipment" in resolved)) {
    return { ok: true, ignored: "shipment_not_found" };
  }

  const ship = resolved.shipment;
  const provisioned = "provisioned" in resolved && Boolean(resolved.provisioned);

  if (norm(ship.context) === "member_intake") {
    try {
      const destMeta = await readMemberIntakeDestinationMetadata(admin, ship.id);
      const orderNumber = extractSendcloudOrderNumber(payload);
      const outgoingRaw = destMeta.sc_outgoing_parcel_id;
      const outgoingParcelId =
        typeof outgoingRaw === "number"
          ? outgoingRaw
          : typeof outgoingRaw === "string"
            ? parseInt(outgoingRaw, 10)
            : NaN;
      const isOutgoingParcel =
        parcelId != null &&
        Number.isFinite(outgoingParcelId) &&
        outgoingParcelId > 0 &&
        parcelId === outgoingParcelId;

      if (parcelId && !isOutgoingParcel) {
        await patchMemberIntakeShipmentReturnParcel(admin, ship.id, parcelId, { orderNumber });
      }
      if (trackingNumber && isIntakeMemberReturnTrackingNumber(trackingNumber)) {
        await syncMemberIntakeShipmentTracking(admin, ship.id, { trackingNumber, trackingUrl });
      } else if (trackingUrl && !isOutgoingParcel) {
        await syncMemberIntakeShipmentTracking(admin, ship.id, { trackingUrl });
      }
    } catch (e) {
      console.error("[sendcloud-webhook] member_intake sync", e);
    }
  }

  if (norm(ship.context) === "cart_return") {
    try {
      if (parcelId) {
        await patchCartReturnShipmentReturnParcel(admin, ship.id, parcelId);
      }
      if (trackingNumber || trackingUrl) {
        await syncCartReturnShipmentTracking(admin, ship.id, { trackingNumber, trackingUrl });
      }
    } catch (e) {
      console.error("[sendcloud-webhook] cart_return sync", e);
    }
  }

  if (norm(ship.context) === "cart_outbound" && !cartOutboundAllowsSendcloudWebhookSync(ship.status)) {
    return { ok: true, ignored: "cart_outbound_awaiting_backoffice_ready" };
  }

  const eventSource = options?.source?.trim() || "sendcloud_webhook";

  const mapOptions: MapSendcloudParcelOptions = {};
  if (norm(ship.context) === "cart_outbound") {
    mapOptions.cartOutboundHome = await loadCartOutboundHomeDelivery(admin, ship.id);
  }

  const target = mapSendcloudParcelToShipmentTarget(ship.context, statusMessage, statusId, mapOptions);
  if (!target) {
    if (trackingNumber || trackingUrl) {
      await admin
        .from("shipments")
        .update({
          ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
          ...(trackingUrl ? { member_tracking_url: trackingUrl } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", ship.id);
    }
    if (provisioned) {
      return {
        ok: true,
        shipment_id: ship.id,
        parcel_id: parcelId,
        status: norm(ship.status),
        transitions: [],
        provisioned: true,
      };
    }
    return { ok: true, ignored: "status_unmapped" };
  }

  const transitions: string[] = [];
  let current = norm(ship.status);
  const chain = buildForwardChain(ship.context, current, target, mapOptions);

  if (chain.length === 0) {
    if (trackingNumber || trackingUrl) {
      await admin
        .from("shipments")
        .update({
          ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
          ...(trackingUrl ? { member_tracking_url: trackingUrl } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", ship.id);
    }
    return {
      ok: true,
      shipment_id: ship.id,
      parcel_id: parcelId,
      status: current,
      transitions: [],
    };
  }

  const nowIso = new Date().toISOString();
  for (const step of chain) {
    const tr = await transitionShipmentStatus(admin, {
      shipmentId: ship.id,
      ifCurrentStatus: current,
      toStatus: step,
      actorUserId: null,
      reason: `Sendcloud : ${statusMessage || step}`,
      source: eventSource,
      context: {
        parcel_id: parcelId,
        order_number: extractSendcloudOrderNumber(payload),
        status_id: statusId,
        status_message: statusMessage,
      },
      occurredAt: nowIso,
      trackingNumber: trackingNumber ?? undefined,
      setReadyAt: false,
    });
    if (!tr.ok) {
      if (tr.error === "STATUS_MISMATCH") {
        const { data: fresh } = await admin.from("shipments").select("status").eq("id", ship.id).maybeSingle();
        current = norm((fresh as { status?: unknown } | null)?.status);
        if (current === step) {
          transitions.push(step);
          continue;
        }
        break;
      }
      return { ok: false, error: tr.error };
    }
    transitions.push(step);
    current = step;
  }

  if (trackingNumber || trackingUrl) {
    await admin
      .from("shipments")
      .update({
        ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
        ...(trackingUrl ? { member_tracking_url: trackingUrl } : {}),
        updated_at: nowIso,
      })
      .eq("id", ship.id);
  }

  return {
    ok: true,
    shipment_id: ship.id,
    parcel_id: parcelId,
    status: current,
    transitions,
    ...(provisioned ? { provisioned: true } : {}),
  };
}
