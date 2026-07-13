import type { SupabaseClient } from "@supabase/supabase-js";

import { isCartReturnLockedForMemberSetup, normalizeCartReturnShipmentStatus } from "@/lib/cart/cart-return-status";
import { ensureCartReturnShipmentForPortal, isCartReturnSendcloudOrderProvisioned } from "@/lib/cart/cart-return-shipment";
import { isGuestPurchaseCartOrder } from "@/lib/cart/guest-purchase-order";
import { provisionCartReturnSendcloudOrder } from "@/lib/cart/provision-cart-return-sendcloud-order";
import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";
import { getSendcloudEnv } from "@/lib/sendcloud/config";
import { resolveSendcloudIntegrationId } from "@/lib/sendcloud/integrations";
import { createSendcloudOrderLabelSync } from "@/lib/sendcloud/orders-api";
import { buildSendcloudOrderNumber } from "@/lib/sendcloud/parcel-sync";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CartReturnSendcloudAutoResult =
  | { ok: true; shipment_id: string; label_url: string; numero_suivi: string | null; reused?: boolean }
  | { ok: false; error: string; status: number; developer_hint?: string };

/**
 * Retour panier emprunt via Sendcloud : réutilise la commande importée (provision) puis étiquette.
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

  if (await isGuestPurchaseCartOrder(admin, cartId)) {
    return { ok: false, error: "Cette commande est un achat définitif : pas de retour location.", status: 400 };
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

  let returnShipId: string;
  let returnStatus: string;
  const ensuredReturn = await ensureCartReturnShipmentForPortal(admin, cartId, "", {
    assignSendcloudProvider: false,
  });
  if (!ensuredReturn.ok) {
    return {
      ok: false,
      error: ensuredReturn.error,
      status: 500,
    };
  }
  returnShipId = ensuredReturn.shipmentId;

  const { data: returnShipRow } = await admin
    .from("shipments")
    .select("status")
    .eq("id", returnShipId)
    .maybeSingle();
  returnStatus =
    normalizeCartReturnShipmentStatus(String((returnShipRow as { status?: string } | null)?.status ?? "")) ??
    "pending";

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

  const { data: inv } = await admin
    .from("cart_order_stripe_invoices")
    .select("checkout_delivery_channel, checkout_home_speed")
    .eq("cart_id", cartId)
    .maybeSingle();
  const invRow = inv as { checkout_delivery_channel?: string | null; checkout_home_speed?: string | null } | null;
  const deliveryChannel: "relay" | "home" =
    (invRow?.checkout_delivery_channel ?? "").trim().toLowerCase() === "home" ? "home" : "relay";
  const homeSpeed = (invRow?.checkout_home_speed ?? "").trim() || null;

  const { data: retDestRow } = await admin
    .from("shipment_destinations")
    .select("metadata")
    .eq("shipment_id", returnShipId)
    .limit(1)
    .maybeSingle();
  let retDestMeta =
    (retDestRow as { metadata?: Record<string, unknown> } | null)?.metadata &&
    typeof (retDestRow as { metadata?: Record<string, unknown> }).metadata === "object"
      ? ((retDestRow as { metadata: Record<string, unknown> }).metadata as Record<string, unknown>)
      : {};

  if (!isCartReturnSendcloudOrderProvisioned(retDestMeta)) {
    const provisioned = await provisionCartReturnSendcloudOrder(admin, {
      cartId,
      deliveryChannel,
      homeSpeed,
    });
    if (!provisioned.ok) {
      return { ok: false, error: provisioned.error, status: 502 };
    }
    if ("skipped" in provisioned && provisioned.skipped && provisioned.reason !== "already_provisioned") {
      return {
        ok: false,
        error: `Retour non provisionné : ${provisioned.reason}.`,
        status: provisioned.reason === "uber_direct" ? 400 : 502,
      };
    }
    const { data: retDestReload } = await admin
      .from("shipment_destinations")
      .select("metadata")
      .eq("shipment_id", returnShipId)
      .limit(1)
      .maybeSingle();
    retDestMeta =
      (retDestReload as { metadata?: Record<string, unknown> } | null)?.metadata &&
      typeof (retDestReload as { metadata?: Record<string, unknown> }).metadata === "object"
        ? ((retDestReload as { metadata: Record<string, unknown> }).metadata as Record<string, unknown>)
        : {};
  }

  const genRaw = retDestMeta.sendcloud_label_generation;
  const generation =
    typeof genRaw === "number" && Number.isFinite(genRaw) && genRaw > 0
      ? Math.trunc(genRaw)
      : Number(genRaw) > 0
        ? Math.trunc(Number(genRaw))
        : 1;
  const orderNumber =
    String(retDestMeta.sendcloud_order_number ?? "").trim() ||
    buildSendcloudOrderNumber({ cartId, shipmentId: returnShipId, generation });

  const integrationId = await resolveSendcloudIntegrationId(env);
  if (!integrationId) {
    return { ok: false, error: "Integration Sendcloud introuvable.", status: 502 };
  }

  const viaOrder = await createSendcloudOrderLabelSync(env, {
    integration_id: integrationId,
    order: { order_number: orderNumber },
    ship_with: {},
  });
  if (!viaOrder.ok) {
    return { ok: false, error: viaOrder.error, status: 502 };
  }

  const trackingNumber = viaOrder.trackingNumber;
  const labelUrl = viaOrder.labelUrl;
  const trackingUrl: string | null = null;

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
