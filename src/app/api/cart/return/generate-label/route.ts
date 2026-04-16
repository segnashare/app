import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  DEFAULT_POUCH_DEPTH_CM,
  DEFAULT_POUCH_LENGTH_CM,
  DEFAULT_POUCH_WIDTH_CM,
  defaultParcelWeightGramsFromCategory,
} from "@/lib/mondial-relay/category-parcel-defaults";
import { getMondialRelayConnectEnv } from "@/lib/mondial-relay/config";
import { performMrConnectRelayWithProductFallback } from "@/lib/mondial-relay/mr-perform-connect";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { getSegnaRecipientFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import type { MrPerson } from "@/lib/mondial-relay/shipment-xml";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RELAY_PRODUCTS = new Set(["24R", "24L", "LCC", "XOH"]);
const CART_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BLOCKED_RETURN_STATUSES = new Set([
  "dropped_out",
  "in_transit_in",
  "in_transit_out",
  "returned",
  "en_verification",
  "return_validated",
  "closed",
]);

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
  let weightG = 0;
  let valueEur = 0;
  const titles: string[] = [];
  for (const d of rows) {
    const catEmb = d.item_categories;
    const catRow = Array.isArray(catEmb) ? catEmb[0] : catEmb;
    const cat = catRow?.name ?? null;
    weightG += defaultParcelWeightGramsFromCategory(cat);
    const p = d.price_points;
    if (p != null && Number.isFinite(Number(p))) valueEur += Math.max(0, Math.round(Number(p)));
    const t = d.title?.trim();
    if (t) titles.push(t);
  }
  const contentLabel = titles.length > 0 ? titles.join(" · ").slice(0, 200) : "Retour panier Segna";
  return {
    weightG: Math.max(1, weightG),
    valueEur: Math.max(0, valueEur),
    contentLabel,
    lengthCm: DEFAULT_POUCH_LENGTH_CM,
    widthCm: DEFAULT_POUCH_WIDTH_CM,
    depthCm: DEFAULT_POUCH_DEPTH_CM,
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const cartId = typeof o.cart_id === "string" ? o.cart_id.trim() : "";
  const relayCode = typeof o.relay_code === "string" ? o.relay_code.trim() : "";
  const relayLabel = typeof o.relay_label === "string" ? o.relay_label.trim() : "";
  const relaySearchPcDigits =
    typeof o.relay_search_postal_code === "string" ? o.relay_search_postal_code.replace(/\D/g, "").slice(0, 5) : "";
  const relaySearchPostal = /^\d{5}$/.test(relaySearchPcDigits) ? relaySearchPcDigits : null;
  const deliveryMode = o.delivery_mode === "home" ? "home" : "relay";
  const productRaw = typeof o.mr_relay_product === "string" ? o.mr_relay_product.trim().toUpperCase() : "24R";
  const relayProduct = RELAY_PRODUCTS.has(productRaw) ? productRaw : "24R";

  if (!CART_ID_RE.test(cartId)) {
    return NextResponse.json({ ok: false as const, error: "cart_id invalide" }, { status: 400 });
  }
  if (deliveryMode === "relay" && !relayCode) {
    return NextResponse.json({ ok: false as const, error: "relay_code requis en mode point relais" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false as const, error: "Authentification requise" }, { status: 401 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Service indisponible" }, { status: 503 });
  }

  const config = getMondialRelayConnectEnv();
  if (!config) {
    return NextResponse.json({ ok: false as const, error: "Mondial Relay non configuré (MONDR_CONNECT_*)" }, { status: 501 });
  }
  const segnaRecipient = getSegnaRecipientFromEnv();
  if (!segnaRecipient) {
    return NextResponse.json({ ok: false as const, error: "Hub Segna incomplet (MONDR_SEGNA_RECIP_*)" }, { status: 501 });
  }

  const { data: cart } = await admin
    .from("carts")
    .select("id,user_id,status")
    .eq("id", cartId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cart || cart.user_id !== user.id) {
    return NextResponse.json({ ok: false as const, error: "Panier introuvable" }, { status: 404 });
  }
  if (cart.status !== "confirmed") {
    return NextResponse.json({ ok: false as const, error: "Panier non éligible au retour." }, { status: 400 });
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
    return NextResponse.json(
      { ok: false as const, error: "La livraison aller doit être indiquée comme livrée avant le retour." },
      { status: 400 },
    );
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
    return NextResponse.json({ ok: false as const, error: "Panier sans pièces." }, { status: 400 });
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
    returnStatus = String(existingReturn.status ?? "").toLowerCase();
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
      return NextResponse.json(
        { ok: false as const, error: insErr?.message ?? "Création expédition retour impossible" },
        { status: 500 },
      );
    }
    returnShipId = String(inserted.id);
    returnStatus = String(inserted.status ?? "pending").toLowerCase();
  }

  if (BLOCKED_RETURN_STATUSES.has(returnStatus)) {
    return NextResponse.json(
      { ok: false as const, error: "Cette expédition retour est déjà prise en charge." },
      { status: 409 },
    );
  }

  const { data: existingLabels } = await admin
    .from("shipment_labels")
    .select("label_url")
    .eq("shipment_id", returnShipId)
    .limit(1);
  const firstLab = existingLabels?.[0] as { label_url?: string } | undefined;
  if (firstLab?.label_url?.trim()) {
    const { data: shipRow } = await admin.from("shipments").select("tracking_number").eq("id", returnShipId).maybeSingle();
    const tn = (shipRow as { tracking_number?: string } | null)?.tracking_number ?? null;
    return NextResponse.json({
      ok: true as const,
      shipment_id: returnShipId,
      label_url: firstLab.label_url.trim(),
      numero_suivi: typeof tn === "string" && tn.trim() ? tn.trim() : null,
      reused: true as const,
    });
  }

  if (returnStatus !== "pending" && returnStatus !== "ready") {
    return NextResponse.json(
      { ok: false as const, error: `Statut retour inattendu : ${returnStatus}` },
      { status: 409 },
    );
  }

  const { data: member } = await admin
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ ok: false as const, error: "Profil membre introuvable" }, { status: 400 });
  }
  const fn = (member.first_name as string | null | undefined)?.trim();
  const ln = (member.last_name as string | null | undefined)?.trim();
  const email = (member.email as string | null | undefined)?.trim();
  const phone = String((member.phone as string | null | undefined) ?? "").replace(/\s/g, "").trim();
  if (!fn || !ln || !email || !phone) {
    return NextResponse.json({ ok: false as const, error: "Profil incomplet (prénom, nom, email, téléphone)." }, { status: 400 });
  }
  const addr = parseMemberAdressForShipment((member.adress as string | null | undefined) ?? null);
  if (!addr?.sender_street || !addr.sender_houseno || !addr.sender_postcode || !addr.sender_city) {
    return NextResponse.json({ ok: false as const, error: "Adresse profil incomplète (rue, n°, CP, ville)." }, { status: 400 });
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
  const orderSuffix = `-crt${createHash("sha256").update(returnShipId).digest("hex").slice(0, 8)}`;
  const title = `Retour panier ${cartId.slice(0, 8)} (${sortedItems.length}p)`;

  const result = await performMrConnectRelayWithProductFallback(config, {
    itemId: primaryItemId,
    itemTitle: title,
    sender,
    recipient: segnaRecipient,
    /** Un colis physique ; une seule ligne `Parcel` dans le XML Connect. */
    parcelCount: 1,
    contentValueEur: parcel.valueEur > 0 ? parcel.valueEur : null,
    weightGr: Math.min(9000, Math.max(400, parcel.weightG)),
    lengthCm: parcel.lengthCm,
    widthCm: parcel.widthCm,
    depthCm: parcel.depthCm,
    parcelContent: parcel.contentLabel,
    deliveryInstructions: `Retour membre → Segna — panier ${cartId}`,
    deliveryHome: deliveryMode === "home",
    relayLocation: deliveryMode === "relay" ? relayCode : null,
    collectionMode: "REL",
    relayDeliveryMode: relayProduct as "24R" | "24L" | "LCC" | "XOH",
    orderNoSuffix: orderSuffix,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false as const, error: result.message.slice(0, 280) }, { status: 502 });
  }

  const { error: providerErr } = await admin.rpc("set_shipment_provider", {
    p_shipment_id: returnShipId,
    p_provider_code: "mondial_relay",
  });
  if (providerErr) {
    return NextResponse.json({ ok: false as const, error: `Transporteur : ${providerErr.message}` }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const { error: upShipErr } = await admin
    .from("shipments")
    .update({
      tracking_number: result.sendingNumber,
      status: "ready",
      updated_at: nowIso,
    })
    .eq("id", returnShipId);

  if (upShipErr) {
    return NextResponse.json(
      { ok: false as const, error: `MR ok mais mise à jour envoi : ${upShipErr.message}`, label_url: result.etiquetteLink },
      { status: 500 },
    );
  }

  const { error: labErr } = await admin.from("shipment_labels").insert({
    shipment_id: returnShipId,
    label_url: result.etiquetteLink,
    label_format: "pdf",
    label_status: "created",
  });

  if (labErr) {
    return NextResponse.json(
      {
        ok: false as const,
        error: `Étiquette créée mais enregistrement impossible : ${labErr.message}`,
        label_url: result.etiquetteLink,
        numero_suivi: result.sendingNumber,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true as const,
    shipment_id: returnShipId,
    label_url: result.etiquetteLink,
    numero_suivi: result.sendingNumber,
    relay_meta: {
      relay_code: deliveryMode === "relay" ? relayCode : null,
      relay_label: deliveryMode === "relay" ? relayLabel || relayCode : null,
      relay_search_postal_code: deliveryMode === "relay" ? relaySearchPostal : null,
    },
  });
}
