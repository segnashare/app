import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { buildFranceUberAddressJson } from "@/lib/uber-direct/addresses";
import { readUberDirectConfig } from "@/lib/uber-direct/config";
import { createUberDelivery, fetchUberDeliveryQuoteRaw } from "@/lib/uber-direct/deliveries-api";
import { uberQuoteFeeCentsFromRaw } from "@/lib/uber-direct/format-quote-for-display";

/** Résultat post-confirmation panier (ne bloque jamais la commande). */
export type UberDirectStripePostResult =
  | { status: "not_applicable" }
  | { status: "skipped"; reason: "config" | "address_metadata" | "phone" }
  | { status: "created" }
  | { status: "duplicate_ignored" }
  | { status: "failed"; error: string };

function metaNum(session: Stripe.Checkout.Session, key: string): number | null {
  const raw = session.metadata?.[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function metaStr(session: Stripe.Checkout.Session, key: string): string {
  return (session.metadata?.[key] ?? "").trim();
}

function normalizeDropoffPhone(userPhone: string | null | undefined, fallback: string | null): string | null {
  const u = (userPhone ?? "").replace(/\s+/g, "").trim();
  if (u) {
    if (u.startsWith("+")) return u;
    if (/^0[67]\d{8}$/.test(u)) return `+33${u.slice(1)}`;
    return u;
  }
  const f = (fallback ?? "").replace(/\s+/g, "").trim();
  if (!f) return null;
  if (f.startsWith("+")) return f;
  if (/^0[67]\d{8}$/.test(f)) return `+33${f.slice(1)}`;
  return f;
}

function isUberDirectHomeSpeed(session: Stripe.Checkout.Session): boolean {
  const speed = metaStr(session, "home_speed");
  if (speed === "uber_direct" || speed === "priority") return true;
  return false;
}

async function attachUberDeliveryToCartOutboundShipment(
  admin: SupabaseClient,
  cartId: string,
  uberDeliveryId: string,
  trackingUrl?: string,
): Promise<void> {
  const { data: prov, error: pErr } = await admin
    .from("shipment_providers")
    .select("id")
    .eq("code", "uber_direct")
    .maybeSingle();

  if (pErr) {
    console.error("[uber-direct] shipment_providers", pErr.message);
  }

  const providerId =
    prov && typeof prov === "object" && typeof (prov as { id?: unknown }).id === "string"
      ? (prov as { id: string }).id
      : null;

  if (!providerId) {
    console.error(
      "[uber-direct] Fournisseur uber_direct introuvable dans shipment_providers — vérifie les migrations / seed.",
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
    console.error("[uber-direct] Lecture shipment aller", sErr.message);
    return;
  }

  const shipmentId =
    ship && typeof ship === "object" && typeof (ship as { id?: unknown }).id === "string"
      ? (ship as { id: string }).id
      : null;

  if (!shipmentId) {
    console.warn("[uber-direct] Aucun shipment cart_outbound pour cart", cartId);
    return;
  }

  const trimmedUrl = typeof trackingUrl === "string" && trackingUrl.trim() ? trackingUrl.trim() : null;
  const { error: uErr } = await admin
    .from("shipments")
    .update({
      provider_id: providerId,
      tracking_number: uberDeliveryId,
      member_tracking_url: trimmedUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shipmentId)
    .eq("context", "cart_outbound");

  if (uErr) {
    console.error("[uber-direct] Mise à jour shipment (Uber)", uErr.message);
  } else {
    console.log("[uber-direct] Shipment aller lié à Uber", shipmentId, uberDeliveryId);
  }
}

function defaultManifestItems(itemCount: number) {
  return [
    {
      name: `Commande Segna — ${itemCount} article(s)`,
      quantity: 1,
      weight: Math.min(15_000, 400 + itemCount * 400),
      dimensions: { length: 40, height: 25, depth: 30 },
    },
  ];
}

async function recordUberHomeOutboundFailure(
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
    uber_outbound_failed: true,
    uber_outbound_failed_at: new Date().toISOString(),
    uber_outbound_error: errorSnippet.slice(0, 500),
  };

  const { error: uErr } = await admin.from("shipment_destinations").update({ metadata: next }).eq("id", row.id);
  if (uErr) {
    console.error("[uber-direct] Persistance échec Uber (metadata)", uErr.message);
  }
}

async function persistUberBookingSnapshot(
  admin: SupabaseClient,
  cartId: string,
  quoteRaw: Record<string, unknown>,
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

  const feeCents = uberQuoteFeeCentsFromRaw(quoteRaw);
  const snap: Record<string, unknown> = {
    uber_booking_fee_cents: feeCents,
    uber_booking_dropoff_eta: typeof quoteRaw.dropoff_eta === "string" ? quoteRaw.dropoff_eta : undefined,
    uber_booking_pickup_eta: typeof quoteRaw.pickup_eta === "string" ? quoteRaw.pickup_eta : undefined,
    uber_booking_duration_min:
      typeof quoteRaw.duration === "number"
        ? quoteRaw.duration
        : typeof quoteRaw.duration === "string" && quoteRaw.duration.trim() !== ""
          ? Number(quoteRaw.duration)
          : undefined,
    uber_booking_pickup_duration_min:
      typeof quoteRaw.pickup_duration === "number"
        ? quoteRaw.pickup_duration
        : typeof quoteRaw.pickup_duration === "string" && String(quoteRaw.pickup_duration).trim() !== ""
          ? Number(quoteRaw.pickup_duration)
          : undefined,
    uber_booking_quote_expires: typeof quoteRaw.expires === "string" ? quoteRaw.expires : undefined,
    uber_booking_recorded_at: new Date().toISOString(),
  };

  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(snap)) {
    if (v != null && v !== "" && !(typeof v === "number" && !Number.isFinite(v))) {
      merged[k] = v;
    }
  }
  delete merged.uber_outbound_failed;
  delete merged.uber_outbound_failed_at;
  delete merged.uber_outbound_error;

  const { error: uErr } = await admin.from("shipment_destinations").update({ metadata: merged }).eq("id", row.id);
  if (uErr) {
    console.error("[uber-direct] Persistance snapshot devis Uber (metadata)", uErr.message);
  }
}

/**
 * Crée la livraison Uber Direct à partir d’une session Checkout (métadonnées adresse / vitesse).
 * Appeler **après** passage de l’expédition aller en `ready` (`launchUberDirectForCartOutboundReady`), pas au paiement.
 * Ne lève pas : les erreurs sont journalisées.
 */
export async function tryCreateUberDirectFromStripeSession(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<UberDirectStripePostResult> {
  if (session.metadata?.checkout_kind !== "cart_order") return { status: "not_applicable" };
  if (session.metadata?.delivery_channel !== "home") return { status: "not_applicable" };
  if (!isUberDirectHomeSpeed(session)) return { status: "not_applicable" };

  const config = readUberDirectConfig();
  if (!config) {
    console.warn("[uber-direct] Config incomplète — livraison Uber ignorée.");
    return { status: "skipped", reason: "config" };
  }

  const lat = metaNum(session, "delivery_lat");
  const lon = metaNum(session, "delivery_lon");
  const line1 = metaStr(session, "delivery_line1");
  const cartIdEarly = metaStr(session, "cart_id");
  if (lat == null || lon == null || !line1) {
    console.warn("[uber-direct] Métadonnées adresse incomplètes — livraison Uber ignorée.");
    if (cartIdEarly) {
      await recordUberHomeOutboundFailure(admin, cartIdEarly, "uber_skipped:address_metadata_incomplete");
    }
    return { status: "skipped", reason: "address_metadata" };
  }

  const cityMeta = metaStr(session, "delivery_city");
  const instructions = metaStr(session, "delivery_instructions");

  const { data: userRowRaw, error: userErr } = await admin
    .from("users")
    .select("phone, first_name")
    .eq("id", userId)
    .maybeSingle();

  if (userErr) {
    console.error("[uber-direct] Lecture users", userErr.message);
  }

  const userRow = userRowRaw && typeof userRowRaw === "object" ? (userRowRaw as Record<string, unknown>) : null;

  const dropoffPhone = normalizeDropoffPhone(
    typeof userRow?.phone === "string" ? userRow.phone : null,
    config.dropoffPhoneFallback,
  );
  if (!dropoffPhone) {
    console.warn("[uber-direct] Pas de téléphone livraison — Uber ignoré.");
    if (cartIdEarly) {
      await recordUberHomeOutboundFailure(admin, cartIdEarly, "uber_skipped:no_member_phone");
    }
    return { status: "skipped", reason: "phone" };
  }

  const dropoffName =
    typeof userRow?.first_name === "string" && userRow.first_name.trim()
      ? userRow.first_name.trim()
      : "Client Segna";

  const cartId = cartIdEarly;
  const itemCountRaw = metaStr(session, "item_count");
  const itemCount = Math.max(1, Math.min(50, Number.parseInt(itemCountRaw || "1", 10) || 1));

  let manifestItems = defaultManifestItems(itemCount);
  if (cartId) {
    const { data: linesRaw, error: linesErr } = await admin
      .from("cart_items")
      .select("items ( title, item_custom_brand_label, item_brands ( label ) )")
      .eq("cart_id", cartId);

    const lines = Array.isArray(linesRaw) ? linesRaw : [];
    if (!linesErr && lines.length > 0) {
      const names: string[] = [];
      for (const row of lines) {
        const it = (row as {
          items?: {
            title?: string;
            item_custom_brand_label?: string;
            item_brands?: { label?: string | null } | null;
          } | null;
        }).items;
        const title = (it?.title ?? "").trim();
        const brand =
          (typeof it?.item_custom_brand_label === "string" && it.item_custom_brand_label.trim()) ||
          (typeof it?.item_brands?.label === "string" && it.item_brands.label.trim()) ||
          "";
        const label = [title, brand].filter(Boolean).join(" — ") || "Article";
        names.push(label);
      }
      if (names.length > 0) {
        manifestItems = names.slice(0, 20).map((name) => ({
          name: name.slice(0, 120),
          quantity: 1,
          weight: 500,
          dimensions: { length: 35, height: 20, depth: 25 },
        }));
      }
    }
  }

  const dropoffAddressJson = buildFranceUberAddressJson(line1, cityMeta || null);

  const externalId = `segna_stripe_checkout:${session.id}`.slice(0, 128);

  console.log(
    "[uber-direct] Création livraison (session, external_id)",
    session.id,
    externalId,
  );

  try {
    const quoteParsed = await fetchUberDeliveryQuoteRaw({ config, dropoffAddressJson });
    const quoteId = typeof quoteParsed.id === "string" ? quoteParsed.id : "";
    if (!quoteId) {
      throw new Error("uber_quote_missing_id");
    }
    const created = await createUberDelivery({
      config,
      quoteId,
      dropoffAddressJson,
      dropoffName,
      dropoffPhone,
      dropoffNotes: instructions || undefined,
      manifestItems,
      externalId,
    });
    console.log(
      "[uber-direct] Livraison créée",
      created.id,
      created.trackingUrl ?? "",
      "— vérifier l’emplacement / fuseau dans le portail Uber (onglets À venir / Passées si « Aujourd’hui » est vide).",
    );

    if (cartId) {
      await attachUberDeliveryToCartOutboundShipment(admin, cartId, created.id, created.trackingUrl);
      await persistUberBookingSnapshot(admin, cartId, quoteParsed);
    }
    return { status: "created" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      /uber_delivery_409\b/i.test(msg) ||
      /\bduplicate\b/i.test(msg) ||
      /\bexternal_id\b/i.test(msg)
    ) {
      console.warn("[uber-direct] Création non rejouée (doublon / idempotence)", msg.slice(0, 400));
      return { status: "duplicate_ignored" };
    }
    console.error("[uber-direct] Échec création livraison", msg);
    if (cartId) {
      await recordUberHomeOutboundFailure(admin, cartId, msg);
    }
    return { status: "failed", error: msg.slice(0, 400) };
  }
}
