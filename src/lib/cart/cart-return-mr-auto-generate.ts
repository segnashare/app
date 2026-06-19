import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_POUCH_DEPTH_CM,
  DEFAULT_POUCH_LENGTH_CM,
  DEFAULT_POUCH_WIDTH_CM,
  defaultParcelWeightGramsFromCategory,
} from "@/lib/mondial-relay/category-parcel-defaults";
import { getMondialRelayConnectEnv, getMondialRelaySoapEnv } from "@/lib/mondial-relay/config";
import { performMrConnectRelayWithProductFallback } from "@/lib/mondial-relay/mr-perform-connect";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import {
  getSegnaRecipientFromEnv,
  getSegnaReturnDeliveryRelayCodesFromEnv,
  getSegnaReturnRelayProductFromEnv,
} from "@/lib/mondial-relay/segna-recipient-env";
import { filterRelayHitsByPlanTri } from "@/lib/mondial-relay/soap-plan-tri-pretri";
import { searchRelayPointsSoap } from "@/lib/mondial-relay/soap-point-relais-search";
import type { MrPerson } from "@/lib/mondial-relay/shipment-xml";
import { MR_AUTO_GENERATE_ENV_HINT } from "@/lib/items/member-mr-auto-generate";
import { transitionShipmentStatus } from "@/lib/shipment/transition-shipment-status";

const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

import { isCartReturnLockedForMemberSetup, normalizeCartReturnShipmentStatus } from "@/lib/cart/cart-return-status";

const DEFAULT_MAX_RELAYS = 25;
const DELAY_MS_BETWEEN_RELAY_ATTEMPTS = 400;

type ItemRow = {
  id: string;
  title: string | null;
  price_points: number | null;
  item_categories: { name: string | null } | { name: string | null }[] | null;
};

function aggregateReturnParcel(rows: ItemRow[]): {
  weightG: number;
  valueEur: number;
  contentLabel: string;
  lengthCm: number;
  widthCm: number;
  depthCm: number;
} {
  let valueEur = 0;
  const titles: string[] = [];
  for (const d of rows) {
    const p = d.price_points;
    if (p != null && Number.isFinite(Number(p))) valueEur += Math.max(0, Math.round(Number(p)));
    const t = d.title?.trim();
    if (t) titles.push(t);
  }
  const contentLabel = titles.length > 0 ? titles.join(" · ").slice(0, 200) : "Retour panier Segna";
  return {
    weightG: defaultParcelWeightGramsFromCategory(null),
    valueEur: Math.max(0, valueEur),
    contentLabel,
    lengthCm: DEFAULT_POUCH_LENGTH_CM,
    widthCm: DEFAULT_POUCH_WIDTH_CM,
    depthCm: DEFAULT_POUCH_DEPTH_CM,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type CartReturnMrAutoResult =
  | { ok: true; shipment_id: string; label_url: string; numero_suivi: string | null; reused?: boolean }
  | { ok: false; error: string; status: number; developer_hint?: string };

/**
 * Retour panier emprunt : même principe que l’intake — relais MR autour du CP profil, filtre plan de tri vers Segna,
 * essais multi-relais jusqu’à étiquette membre → hub.
 */
export async function runCartReturnMrAutoGenerate(
  admin: SupabaseClient,
  params: { userId: string; cartId: string },
): Promise<CartReturnMrAutoResult> {
  const { userId, cartId } = params;
  if (!CART_ID_RE.test(cartId)) {
    return { ok: false, error: "cart_id invalide", status: 400 };
  }

  const config = getMondialRelayConnectEnv();
  if (!config) {
    return {
      ok: false,
      error: "Mondial Relay non configuré (MONDR_CONNECT_*)",
      status: 501,
      developer_hint: MR_AUTO_GENERATE_ENV_HINT,
    };
  }
  const segnaRecipient = getSegnaRecipientFromEnv();
  if (!segnaRecipient) {
    return {
      ok: false,
      error: "Hub Segna incomplet (MONDR_SEGNA_RECIP_*)",
      status: 501,
      developer_hint: MR_AUTO_GENERATE_ENV_HINT,
    };
  }
  const hubDeliveryRelays = getSegnaReturnDeliveryRelayCodesFromEnv();
  const soap = hubDeliveryRelays.length === 0 ? getMondialRelaySoapEnv() : null;
  if (hubDeliveryRelays.length === 0 && !soap) {
    return {
      ok: false,
      error:
        "Recherche de relais indisponible : il manque la config SOAP MR (MONDR_RELAY_SOAP_ENSEIGNE / MONDR_RELAY_SOAP_PRIVATE_KEY).",
      status: 501,
      developer_hint: MR_AUTO_GENERATE_ENV_HINT,
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

  const { data: lineRows } = await admin
    .from("cart_items")
    .select("item_id, items(id, title, price_points, deleted_at, item_categories(name))")
    .eq("cart_id", cartId)
    .is("deleted_at", null);
  const items: ItemRow[] = [];
  for (const row of lineRows ?? []) {
    const r = row as Record<string, unknown>;
    const itemsRaw = r.items;
    const emb = Array.isArray(itemsRaw) ? itemsRaw[0] : itemsRaw;
    if (!emb || typeof emb !== "object") continue;
    const it = emb as ItemRow & { deleted_at?: string | null };
    if (it.deleted_at != null) continue;
    items.push({
      id: String(it.id ?? r.item_id),
      title: it.title ?? null,
      price_points: it.price_points ?? null,
      item_categories: it.item_categories ?? null,
    });
  }
  if (items.length === 0) {
    return { ok: false, error: "Panier sans pièces.", status: 400 };
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
    const { data: shipRow } = await admin.from("shipments").select("tracking_number").eq("id", returnShipId).maybeSingle();
    const tn = (shipRow as { tracking_number?: string } | null)?.tracking_number ?? null;

    // Préparation BO : étiquette + suivi sans passage en `ready` (envoi laissé `pending`).
    // La file « expédition retour » du back-office ne liste que `ready` et suivants.
    if (returnStatus === "pending") {
      const { error: providerErr } = await admin.rpc("set_shipment_provider", {
        p_shipment_id: returnShipId,
        p_provider_code: "mondial_relay",
      });
      if (providerErr) {
        return { ok: false, error: `Transporteur : ${providerErr.message}`, status: 500 };
      }
      const nowIso = new Date().toISOString();
      const tr = await transitionShipmentStatus(admin, {
        shipmentId: returnShipId,
        ifCurrentStatus: "pending",
        toStatus: "ready",
        actorUserId: userId,
        reason: "Étiquette retour déjà présente — alignement statut membre",
        source: "member_app_cart_return_mr_auto_reuse",
        context: { cart_id: cartId },
        occurredAt: nowIso,
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
  const fn = (member.first_name as string | null | undefined)?.trim();
  const ln = (member.last_name as string | null | undefined)?.trim();
  const email = (member.email as string | null | undefined)?.trim();
  const phone = String((member.phone as string | null | undefined) ?? "")
    .replace(/\s/g, "")
    .trim();
  if (!fn || !ln || !email || !phone) {
    return { ok: false, error: "Profil incomplet (prénom, nom, email, téléphone).", status: 400 };
  }
  const addr = parseMemberAdressForShipment((member.adress as string | null | undefined) ?? null);
  if (!addr?.sender_street || !addr.sender_houseno || !addr.sender_postcode || !addr.sender_city) {
    return { ok: false, error: "Adresse profil incomplète (rue, n°, CP, ville).", status: 400 };
  }
  const country = (addr.sender_country?.trim().toUpperCase() || "FR").slice(0, 2);

  const sender: MrPerson = {
    Firstname: fn,
    Lastname: ln,
    Streetname: addr.sender_street,
    HouseNo: addr.sender_houseno,
    CountryCode: country.length === 2 ? country : "FR",
    PostCode: addr.sender_postcode,
    City: addr.sender_city,
    PhoneNo: "",
    MobileNo: phone,
    Email: email,
  };

  const sortedItems = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const primaryItemId = sortedItems[0]!.id;
  const parcel = aggregateReturnParcel(sortedItems);
  const orderSuffixBase = `-crt${createHash("sha256").update(returnShipId).digest("hex").slice(0, 8)}`;
  const title = `Retour panier ${cartId.slice(0, 8)} (${sortedItems.length}p)`;

  const postcode = addr.sender_postcode.trim();
  const soapWeight = Math.min(9000, Math.max(400, parcel.weightG));

  async function persistReturnAfterMondialSuccess(result: {
    sendingNumber: string;
    etiquetteLink: string;
  }): Promise<CartReturnMrAutoResult> {
    const { error: providerErr } = await admin.rpc("set_shipment_provider", {
      p_shipment_id: returnShipId,
      p_provider_code: "mondial_relay",
    });
    if (providerErr) {
      return { ok: false, error: `Transporteur : ${providerErr.message}`, status: 500 };
    }

    const nowIso = new Date().toISOString();
    if (returnStatus === "ready") {
      const { error: upShipErr } = await admin
        .from("shipments")
        .update({
          tracking_number: result.sendingNumber,
          updated_at: nowIso,
        })
        .eq("id", returnShipId)
        .eq("status", "ready");
      if (upShipErr) {
        return {
          ok: false,
          error: `MR ok mais mise à jour envoi : ${upShipErr.message}`,
          status: 500,
        };
      }
    } else {
      const tr = await transitionShipmentStatus(admin, {
        shipmentId: returnShipId,
        ifCurrentStatus: "pending",
        toStatus: "ready",
        actorUserId: userId,
        reason: "Étiquette retour Mondial Relay générée (auto)",
        source: "member_app_cart_return_mr_auto_generate",
        context: { cart_id: cartId },
        occurredAt: nowIso,
        trackingNumber: result.sendingNumber,
      });
      if (!tr.ok) {
        return {
          ok: false,
          error: `MR ok mais mise à jour envoi : ${tr.error}`,
          status: tr.error === "STATUS_MISMATCH" ? 409 : 500,
        };
      }
    }

    const { error: labErr } = await admin.from("shipment_labels").insert({
      shipment_id: returnShipId,
      label_url: result.etiquetteLink,
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
      label_url: result.etiquetteLink,
      numero_suivi: result.sendingNumber,
    };
  }

  if (hubDeliveryRelays.length > 0) {
    const collectionMode: "REL" | "CCC" =
      (process.env.MONDR_SEGNA_RETURN_COLLECTION_MODE ?? "CCC").trim().toUpperCase() === "REL" ? "REL" : "CCC";
    const primaryProduct = getSegnaReturnRelayProductFromEnv();

    const hubAttempts: { code: string; error: string }[] = [];
    for (let hi = 0; hi < hubDeliveryRelays.length; hi++) {
      const hubCode = hubDeliveryRelays[hi]!;
      if (hi > 0) {
        await sleep(DELAY_MS_BETWEEN_RELAY_ATTEMPTS);
      }
      const orderNoSuffix = hi === 0 ? orderSuffixBase : `${orderSuffixBase}-h${hi}`;

      const result = await performMrConnectRelayWithProductFallback(config, {
        itemId: primaryItemId,
        itemTitle: title,
        sender,
        recipient: segnaRecipient,
        parcelCount: 1,
        contentValueEur: parcel.valueEur > 0 ? parcel.valueEur : null,
        weightGr: soapWeight,
        lengthCm: parcel.lengthCm,
        widthCm: parcel.widthCm,
        depthCm: parcel.depthCm,
        parcelContent: parcel.contentLabel,
        deliveryInstructions: `Retour membre → hub PR ${hubCode} — panier ${cartId}`,
        deliveryHome: false,
        relayLocation: hubCode,
        collectionMode,
        relayDeliveryMode: primaryProduct,
        orderNoSuffix,
      });

      if (!result.ok) {
        hubAttempts.push({ code: hubCode, error: result.message.slice(0, 200) });
        continue;
      }
      return persistReturnAfterMondialSuccess(result);
    }

    const shortHubErr = `Aucun des ${hubDeliveryRelays.length} PR hub n’a accepté l’étiquette retour (${hubAttempts.length} essais).`;
    return { ok: false, error: shortHubErr.slice(0, 280), status: 502 };
  }

  let points: Awaited<ReturnType<typeof searchRelayPointsSoap>>["points"];
  try {
    const res = await searchRelayPointsSoap(soap!, {
      country,
      postalCode: postcode,
      weightGrams: soapWeight,
      action: "24R",
    });
    points = res.points;
    const hub = getSegnaRecipientFromEnv();
    if (hub && points.length > 0) {
      const { kept } = await filterRelayHitsByPlanTri(soap!, points, {
        modeLiv: "24R",
        destPostcode: hub.PostCode,
        destCountry: hub.CountryCode,
      });
      points = kept;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur recherche relais";
    return { ok: false, error: msg.slice(0, 200), status: 502 };
  }

  if (!points.length) {
    return {
      ok: false,
      error: "Aucun point relais compatible près de ton adresse pour ce colis.",
      status: 422,
    };
  }

  const maxRelays = Math.min(
    DEFAULT_MAX_RELAYS,
    Math.max(
      1,
      parseInt(process.env.MONDR_RELAY_TRY_RELAYS_MAX ?? String(DEFAULT_MAX_RELAYS), 10) || DEFAULT_MAX_RELAYS,
    ),
  );

  type RelayCand = { code: string; label: string };
  const seen = new Set<string>();
  const candidates: RelayCand[] = [];
  for (const p of points) {
    const code = String(p.code ?? "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const label = String(p.label ?? p.city ?? code).trim().slice(0, 120);
    candidates.push({ code, label: label || code });
    if (candidates.length >= maxRelays) break;
  }

  if (candidates.length === 0) {
    return { ok: false, error: "Aucun point relais exploitable après filtrage.", status: 422 };
  }

  const attempts: { code: string; error: string }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!;
    if (i > 0) {
      await sleep(DELAY_MS_BETWEEN_RELAY_ATTEMPTS);
    }

    const orderNoSuffix = i === 0 ? orderSuffixBase : `${orderSuffixBase}-r${i}`;

    const result = await performMrConnectRelayWithProductFallback(config, {
      itemId: primaryItemId,
      itemTitle: title,
      sender,
      recipient: segnaRecipient,
      /** Un colis physique ; le XML MR ne porte qu’une entrée `Parcel`. */
      parcelCount: 1,
      contentValueEur: parcel.valueEur > 0 ? parcel.valueEur : null,
      weightGr: soapWeight,
      lengthCm: parcel.lengthCm,
      widthCm: parcel.widthCm,
      depthCm: parcel.depthCm,
      parcelContent: parcel.contentLabel,
      deliveryInstructions: `Retour membre → Segna — panier ${cartId}`,
      deliveryHome: false,
      relayLocation: cand.code,
      collectionMode: "REL",
      relayDeliveryMode: "24R",
      orderNoSuffix,
    });

    if (!result.ok) {
      attempts.push({ code: cand.code, error: result.message.slice(0, 200) });
      continue;
    }

    return persistReturnAfterMondialSuccess(result);
  }

  const shortErr = `Aucun relais du CP n’a permis de créer l’étiquette (${attempts.length} essais).`;
  return { ok: false, error: shortErr.slice(0, 280), status: 502 };
}
