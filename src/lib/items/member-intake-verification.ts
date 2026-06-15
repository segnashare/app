import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveItemPhotoData } from "@/lib/cart/fetch-active-cart-lines";
import { resolveItemListBrandLabel } from "@/lib/items/format-item-custom-brand-label";
import {
  INTAKE_FULFILLMENT_IN_VERIFICATION,
  INTAKE_FULFILLMENT_VERIFIED,
  normalizeIntakeFulfillmentStage,
} from "@/lib/items/intake-fulfillment-stages";
import { readMemberIntakeShipmentIdFromMetadata } from "@/lib/items/intake-shipping-metadata";
import { findActiveTransferIdForItem } from "@/lib/items/member-transfer-items";
import { resolveMemberIntakeItemIds } from "@/lib/items/resolve-member-intake-item-ids";
import { resolveIntakeMemberTrackingHref } from "@/lib/shipping/intake-carrier-tracking";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";

export type MemberIntakeVerificationItem = {
  id: string;
  title: string;
  brand: string | null;
  description: string | null;
  pricePoints: number;
  photoUrl: string | null;
  photoPosition: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
  fulfillmentStage: typeof INTAKE_FULFILLMENT_IN_VERIFICATION | typeof INTAKE_FULFILLMENT_VERIFIED;
};

export type MemberIntakeVerificationSnapshot = {
  transferId: string;
  shipmentId: string;
  shipmentStatus: string;
  trackingNumber: string | null;
  trackingHref: string | null;
  receivedAtIso: string | null;
  items: MemberIntakeVerificationItem[];
};

async function transferOwnedByUser(
  service: SupabaseClient,
  transferId: string,
  ownerUserId: string,
): Promise<boolean> {
  const { data } = await service
    .from("transfers")
    .select("id")
    .eq("id", transferId.trim())
    .eq("user_id", ownerUserId.trim())
    .is("deleted_at", null)
    .maybeSingle();
  return Boolean(data?.id);
}

async function transferIdFromShipment(
  service: SupabaseClient,
  shipmentId: string,
  ownerUserId: string,
): Promise<string | null> {
  const sid = shipmentId.trim();
  if (!sid) return null;

  const { data: ship } = await service
    .from("shipments")
    .select("transfer_id")
    .eq("id", sid)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .maybeSingle();

  const transferId = ship?.transfer_id ? String(ship.transfer_id) : null;
  if (!transferId) return null;
  const owned = await transferOwnedByUser(service, transferId, ownerUserId);
  return owned ? transferId : null;
}

/** Transfer lié à une pièce intake (actif ou clôturé après réception Segna). */
export async function resolveMemberIntakeTransferIdForItem(
  service: SupabaseClient,
  itemId: string,
  ownerUserId: string,
): Promise<string | null> {
  const iid = itemId.trim();
  const uid = ownerUserId.trim();
  if (!iid || !uid) return null;

  const active = await findActiveTransferIdForItem(service, iid);
  if (active && (await transferOwnedByUser(service, active, uid))) {
    return active;
  }

  const { data: intake } = await service
    .from("item_intake")
    .select("metadata")
    .eq("item_id", iid)
    .maybeSingle();

  const shipId = readMemberIntakeShipmentIdFromMetadata(intake?.metadata);
  if (shipId) {
    const fromShipment = await transferIdFromShipment(service, shipId, uid);
    if (fromShipment) return fromShipment;
  }

  return null;
}

export async function buildVerificationTransferIdByItemId(
  service: SupabaseClient,
  ownerUserId: string,
  itemIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(
    unique.map(async (itemId) => {
      const transferId = await resolveMemberIntakeTransferIdForItem(service, itemId, ownerUserId);
      if (transferId) out[itemId] = transferId;
    }),
  );
  return out;
}

function pickReceivedAtIso(shipment: {
  delivered_at?: string | null;
  updated_at?: string | null;
}): string | null {
  const delivered = typeof shipment.delivered_at === "string" ? shipment.delivered_at.trim() : "";
  if (delivered) return delivered;
  const updated = typeof shipment.updated_at === "string" ? shipment.updated_at.trim() : "";
  return updated || null;
}

export async function fetchMemberIntakeVerificationPage(
  service: SupabaseClient,
  ownerUserId: string,
  transferId: string,
): Promise<MemberIntakeVerificationSnapshot | null> {
  const tid = transferId.trim();
  const uid = ownerUserId.trim();
  if (!tid || !uid) return null;

  if (!(await transferOwnedByUser(service, tid, uid))) return null;

  const { data: shipment } = await service
    .from("shipments")
    .select("id, status, tracking_number, member_tracking_url, delivered_at, updated_at")
    .eq("transfer_id", tid)
    .eq("context", "member_intake")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!shipment?.id) return null;

  const shipmentId = String(shipment.id);
  const itemIds = await resolveMemberIntakeItemIds(service, shipmentId);
  if (itemIds.length === 0) return null;

  const { data: itemRows } = await service
    .from("items")
    .select(
      "id, title, description, price_points, photos, owner_user_id, item_brand_id, item_custom_brand_label, item_brands(label, slug), item_intake(fulfillment_stage)",
    )
    .in("id", itemIds)
    .eq("owner_user_id", uid)
    .is("deleted_at", null);

  const ownedRows = itemRows ?? [];
  if (ownedRows.length === 0) return null;

  const brandIds = [
    ...new Set(
      ownedRows
        .map((row) => (typeof row.item_brand_id === "string" ? row.item_brand_id.trim() : ""))
        .filter(Boolean),
    ),
  ];
  const brandById = new Map<string, { label?: string | null; slug?: string | null }>();
  if (brandIds.length > 0) {
    const { data: brandRows } = await service
      .from("item_brands")
      .select("id, label, slug")
      .in("id", brandIds);
    for (const brandRow of brandRows ?? []) {
      if (brandRow?.id) brandById.set(String(brandRow.id), brandRow);
    }
  }

  const fulfillmentStageByItemId = new Map<string, string>();
  for (const row of ownedRows) {
    const raw = row.item_intake as unknown;
    const intake = Array.isArray(raw) ? raw[0] : raw;
    const fs =
      intake && typeof intake === "object"
        ? normalizeIntakeFulfillmentStage(
            (intake as { fulfillment_stage?: string | null }).fulfillment_stage,
          )
        : "";
    fulfillmentStageByItemId.set(String(row.id), fs);
  }

  const hasVerificationItem = [...fulfillmentStageByItemId.values()].some(
    (fs) => fs === INTAKE_FULFILLMENT_IN_VERIFICATION,
  );

  if (!hasVerificationItem) return null;

  const photoPaths: string[] = [];
  const rowsById = new Map<string, (typeof ownedRows)[number]>();
  for (const row of ownedRows) {
    rowsById.set(String(row.id), row);
    const photo = resolveItemPhotoData(row.photos ?? null);
    if (photo.path) photoPaths.push(photo.path);
  }

  const signed = await createSignedUrlsForStoragePaths(service, [...new Set(photoPaths)], 60 * 60 * 24);

  const items: MemberIntakeVerificationItem[] = itemIds
    .map((id) => {
      const row = rowsById.get(id);
      if (!row) return null;
      const photo = resolveItemPhotoData(row.photos ?? null);
      const photoUrl = photo.path ? (signed.get(photo.path) ?? null) : null;
      const brand = resolveItemListBrandLabel({
        title: row.title,
        item_custom_brand_label: row.item_custom_brand_label,
        item_brands:
          (row.item_brands as
            | { label?: string | null; slug?: string | null }
            | Array<{ label?: string | null; slug?: string | null }>
            | null) ??
          (typeof row.item_brand_id === "string" ? brandById.get(row.item_brand_id.trim()) ?? null : null),
      });
      const description =
        typeof row.description === "string" && row.description.trim() ? row.description.trim() : null;
      const fulfillmentStage = fulfillmentStageByItemId.get(id) ?? "";
      if (
        fulfillmentStage !== INTAKE_FULFILLMENT_IN_VERIFICATION &&
        fulfillmentStage !== INTAKE_FULFILLMENT_VERIFIED
      ) {
        return null;
      }
      return {
        id,
        title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Pièce",
        brand,
        description,
        pricePoints: Math.max(0, Math.floor(Number(row.price_points ?? 0))),
        photoUrl,
        photoPosition: photo.position,
        fulfillmentStage,
      };
    })
    .filter((x): x is MemberIntakeVerificationItem => x != null);

  const tracking = resolveIntakeMemberTrackingHref(
    typeof shipment.tracking_number === "string" ? shipment.tracking_number : null,
    typeof shipment.member_tracking_url === "string" ? shipment.member_tracking_url : null,
  );

  return {
    transferId: tid,
    shipmentId,
    shipmentStatus: typeof shipment.status === "string" ? shipment.status.trim().toLowerCase() : "",
    trackingNumber: tracking.trackingNumber,
    trackingHref: tracking.trackingHref,
    receivedAtIso: pickReceivedAtIso(shipment),
    items,
  };
}
