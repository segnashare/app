import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { parseFranceCoursierAddress } from "@/lib/coursier/addresses";
import { readCoursierConfig } from "@/lib/coursier/config";
import { fetchCoursierExpressQuote } from "@/lib/coursier/getprice-api";
import { buildCoursierPickupOrderAddress, createCoursierOrder } from "@/lib/coursier/order-api";
import { buildDefaultCoursierPackages } from "@/lib/coursier/packages";
import { normalizeCoursierPhone } from "@/lib/coursier/phones";
import { syncCoursierShipmentTracking } from "@/lib/coursier/sync-shipment-tracking";
import type { CoursierStripePostResult } from "@/lib/coursier/types";
import { coursierQuoteFeeCentsFromRaw } from "@/lib/coursier/format-quote-for-display";

function metaNum(session: Stripe.Checkout.Session, key: string): number | null {
  const raw = session.metadata?.[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function metaStr(session: Stripe.Checkout.Session, key: string): string {
  return (session.metadata?.[key] ?? "").trim();
}

function isExpressHomeSpeed(session: Stripe.Checkout.Session): boolean {
  const speed = metaStr(session, "home_speed");
  return speed === "uber_direct" || speed === "priority";
}

async function attachCoursierMissionToCartOutboundShipment(
  admin: SupabaseClient,
  cartId: string,
  missionNumber: string,
): Promise<void> {
  const { data: prov, error: pErr } = await admin
    .from("shipment_providers")
    .select("id")
    .eq("code", "coursier")
    .maybeSingle();

  if (pErr) {
    console.error("[coursier] shipment_providers", pErr.message);
  }

  const providerId =
    prov && typeof prov === "object" && typeof (prov as { id?: unknown }).id === "string"
      ? (prov as { id: string }).id
      : null;

  if (!providerId) {
    console.error(
      "[coursier] Fournisseur coursier introuvable dans shipment_providers — vérifie les migrations / seed.",
    );
  }

  const { data: ship, error: sErr } = await admin
    .from("shipments")
    .select("id")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sErr) {
    console.error("[coursier] Lecture shipment aller", sErr.message);
    return;
  }

  const shipmentId =
    ship && typeof ship === "object" && typeof (ship as { id?: unknown }).id === "string"
      ? (ship as { id: string }).id
      : null;

  if (!shipmentId) {
    console.warn("[coursier] Aucun shipment cart_outbound pour cart", cartId);
    return;
  }

  const { error: uErr } = await admin
    .from("shipments")
    .update({
      provider_id: providerId,
      tracking_number: missionNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shipmentId)
    .eq("context", "cart_outbound");

  if (uErr) {
    console.error("[coursier] Mise à jour shipment (Coursier)", uErr.message);
  } else {
    console.log("[coursier] Shipment aller lié à Coursier", shipmentId, missionNumber);
  }
}

async function recordCoursierHomeOutboundFailure(
  admin: SupabaseClient,
  cartId: string,
  errorSnippet: string,
): Promise<void> {
  const { data: ship, error: sErr } = await admin
    .from("shipments")
    .select("id")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sErr || !ship || typeof (ship as { id?: unknown }).id !== "string") return;

  const shipmentId = (ship as { id: string }).id;
  const { data: dest, error: dErr } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", shipmentId)
    .eq("destination_type", "home")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dErr || !dest || typeof (dest as { id?: unknown }).id !== "string") return;

  const row = dest as { id: string; metadata?: unknown };
  const prev =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const next = {
    ...prev,
    coursier_outbound_failed: true,
    coursier_outbound_failed_at: new Date().toISOString(),
    coursier_outbound_error: errorSnippet.slice(0, 500),
  };

  const { error: uErr } = await admin.from("shipment_destinations").update({ metadata: next }).eq("id", row.id);
  if (uErr) {
    console.error("[coursier] Persistance échec (metadata)", uErr.message);
  }
}

async function persistCoursierBookingSnapshot(
  admin: SupabaseClient,
  cartId: string,
  quote: Record<string, unknown>,
  orderPriceHt: number | null,
  missionNumber: string,
): Promise<void> {
  const { data: ship, error: sErr } = await admin
    .from("shipments")
    .select("id")
    .eq("cart_id", cartId)
    .eq("context", "cart_outbound")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sErr || !ship || typeof (ship as { id?: unknown }).id !== "string") return;

  const shipmentId = (ship as { id: string }).id;
  const { data: dest, error: dErr } = await admin
    .from("shipment_destinations")
    .select("id, metadata")
    .eq("shipment_id", shipmentId)
    .eq("destination_type", "home")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dErr || !dest || typeof (dest as { id?: unknown }).id !== "string") return;

  const row = dest as { id: string; metadata?: unknown };
  const prev =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  const feeCents = coursierQuoteFeeCentsFromRaw(quote);
  const snap: Record<string, unknown> = {
    coursier_booking_mission_number: missionNumber,
    coursier_booking_service_id: quote.serviceId,
    coursier_booking_service: quote.service,
    coursier_booking_fee_cents: feeCents,
    coursier_booking_order_price_ht: orderPriceHt,
    coursier_booking_pickup_start: quote.pickupStartDate,
    coursier_booking_pickup_end: quote.pickupEndDate,
    coursier_booking_delivery_start: quote.deliveryStartDate,
    coursier_booking_delivery_end: quote.deliveryEndDate,
    coursier_booking_recorded_at: new Date().toISOString(),
  };

  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(snap)) {
    if (v != null && v !== "" && !(typeof v === "number" && !Number.isFinite(v))) {
      merged[k] = v;
    }
  }
  delete merged.coursier_outbound_failed;
  delete merged.coursier_outbound_failed_at;
  delete merged.coursier_outbound_error;

  const { error: uErr } = await admin.from("shipment_destinations").update({ metadata: merged }).eq("id", row.id);
  if (uErr) {
    console.error("[coursier] Persistance snapshot commande (metadata)", uErr.message);
  }
}

/**
 * Passe commande Coursier à partir d’une session Checkout (métadonnées adresse / vitesse).
 * Appeler **après** passage de l’expédition aller en `ready`, pas au paiement.
 */
export async function tryCreateCoursierFromStripeSession(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<CoursierStripePostResult> {
  if (session.metadata?.checkout_kind !== "cart_order") return { status: "not_applicable" };
  if (session.metadata?.delivery_channel !== "home") return { status: "not_applicable" };
  if (!isExpressHomeSpeed(session)) return { status: "not_applicable" };

  const config = readCoursierConfig();
  if (!config) {
    console.warn("[coursier] Config incomplète — commande ignorée.");
    return { status: "skipped", reason: "config" };
  }

  const lat = metaNum(session, "delivery_lat");
  const lon = metaNum(session, "delivery_lon");
  const line1 = metaStr(session, "delivery_line1");
  const cartIdEarly = metaStr(session, "cart_id");
  if (lat == null || lon == null || !line1) {
    console.warn("[coursier] Métadonnées adresse incomplètes — commande ignorée.");
    if (cartIdEarly) {
      await recordCoursierHomeOutboundFailure(admin, cartIdEarly, "coursier_skipped:address_metadata_incomplete");
    }
    return { status: "skipped", reason: "address_metadata" };
  }

  const cityMeta = metaStr(session, "delivery_city");
  const instructions = metaStr(session, "delivery_instructions");

  const { data: userRowRaw, error: userErr } = await admin
    .from("users")
    .select("phone, first_name, email")
    .eq("id", userId)
    .maybeSingle();

  if (userErr) {
    console.error("[coursier] Lecture users", userErr.message);
  }

  const userRow = userRowRaw && typeof userRowRaw === "object" ? (userRowRaw as Record<string, unknown>) : null;

  const dropoffPhone = normalizeCoursierPhone(
    typeof userRow?.phone === "string" ? userRow.phone : null,
    config.dropoffPhoneFallback,
  );
  if (!dropoffPhone) {
    console.warn("[coursier] Pas de téléphone livraison — commande ignorée.");
    if (cartIdEarly) {
      await recordCoursierHomeOutboundFailure(admin, cartIdEarly, "coursier_skipped:no_member_phone");
    }
    return { status: "skipped", reason: "phone" };
  }

  const dropoffName =
    typeof userRow?.first_name === "string" && userRow.first_name.trim()
      ? userRow.first_name.trim()
      : "Client Segna";
  const dropoffEmail =
    typeof userRow?.email === "string" && userRow.email.trim() ? userRow.email.trim() : undefined;

  const cartId = cartIdEarly;
  const itemCountRaw = metaStr(session, "item_count");
  const itemCount = Math.max(1, Math.min(50, Number.parseInt(itemCountRaw || "1", 10) || 1));

  const toBase = parseFranceCoursierAddress(line1, cityMeta || null);
  const toAddress = {
    ...toBase,
    Contact: dropoffName.slice(0, 50),
    PhoneNumber: dropoffPhone.slice(0, 30),
    ...(dropoffEmail ? { Email: dropoffEmail.slice(0, 100) } : {}),
    ...(instructions ? { Comment: instructions.slice(0, 100) } : {}),
  };

  const packages = buildDefaultCoursierPackages(itemCount);
  const fromAddress = buildCoursierPickupOrderAddress(config);

  const coursierServiceIdMeta = metaStr(session, "coursier_service_id");
  const coursierPickupStartMeta = metaStr(session, "coursier_pickup_start");
  const coursierSlotKeyMeta = metaStr(session, "coursier_slot_key");

  console.log("[coursier] Passage commande (session)", session.id, cartId || "");

  try {
    let serviceId: number;
    let startDate: string;
    let quoteForSnapshot: Record<string, unknown>;

    if (coursierServiceIdMeta && coursierPickupStartMeta) {
      serviceId = Number.parseInt(coursierServiceIdMeta, 10);
      startDate = coursierPickupStartMeta;
      if (!Number.isFinite(serviceId) || serviceId <= 0 || !startDate) {
        throw new Error("coursier_invalid_checkout_metadata");
      }
      quoteForSnapshot = {
        serviceId: coursierServiceIdMeta,
        service: metaStr(session, "coursier_service_id"),
        pickupStartDate: coursierPickupStartMeta,
        deliveryStartDate: metaStr(session, "coursier_delivery_start"),
        deliveryEndDate: metaStr(session, "coursier_delivery_end"),
        priceHtCents: null,
      };
    } else {
      const quote = await fetchCoursierExpressQuote({
        config,
        fromAddress: config.pickupAddress,
        toAddress: toBase,
        packages,
        slotKey: coursierSlotKeyMeta || null,
      });
      serviceId = Number.parseInt(quote.serviceId, 10);
      startDate = quote.pickupStartDate;
      quoteForSnapshot = quote as unknown as Record<string, unknown>;
      if (!Number.isFinite(serviceId) || serviceId <= 0) {
        throw new Error("coursier_invalid_service_id");
      }
    }

    const order = await createCoursierOrder({
      config,
      serviceId,
      fromAddress,
      toAddress,
      packages,
      startDate,
      reference1: cartId ? cartId.slice(0, 50) : undefined,
      reference2: session.id.slice(0, 50),
    });

    const missionNumber = order.MissionNumber;
    const orderPriceHt = typeof order.price === "number" ? order.price : Number(order.price);

    console.log("[coursier] Commande créée", missionNumber);

    if (cartId) {
      await attachCoursierMissionToCartOutboundShipment(admin, cartId, missionNumber);
      await persistCoursierBookingSnapshot(
        admin,
        cartId,
        quoteForSnapshot,
        Number.isFinite(orderPriceHt) ? orderPriceHt : null,
        missionNumber,
      );
      await syncCoursierShipmentTracking(admin, { shipmentId: null, missionNumber, cartId });
    }

    return { status: "created", missionNumber };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/\bduplicate\b/i.test(msg) || /\bdéjà\b/i.test(msg)) {
      console.warn("[coursier] Commande non rejouée (doublon)", msg.slice(0, 400));
      return { status: "duplicate_ignored" };
    }
    console.error("[coursier] Échec passage commande", msg);
    if (cartId) {
      await recordCoursierHomeOutboundFailure(admin, cartId, msg);
    }
    return { status: "failed", error: msg.slice(0, 400) };
  }
}
