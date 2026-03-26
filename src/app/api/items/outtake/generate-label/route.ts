import { NextResponse } from "next/server";

import { DEFAULT_POUCH_DEPTH_CM, DEFAULT_POUCH_LENGTH_CM, DEFAULT_POUCH_WIDTH_CM, defaultParcelWeightGramsFromCategory } from "@/lib/mondial-relay/category-parcel-defaults";
import { getMondialRelayConnectEnv } from "@/lib/mondial-relay/config";
import { performMrConnectShipment } from "@/lib/mondial-relay/mr-perform-connect";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { getSegnaRecipientFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import type { MrPerson } from "@/lib/mondial-relay/shipment-xml";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RELAY_PRODUCTS = new Set(["24R", "24L", "LCC", "XOH"]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false as const, error: "Corps JSON invalide" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const itemId = typeof o.item_id === "string" ? o.item_id.trim() : "";
  const relayCode = typeof o.relay_code === "string" ? o.relay_code.trim() : "";
  const relayLabel = typeof o.relay_label === "string" ? o.relay_label.trim() : "";
  const relaySearchPcDigits =
    typeof o.relay_search_postal_code === "string" ? o.relay_search_postal_code.replace(/\D/g, "").slice(0, 5) : "";
  const relaySearchPostal = /^\d{5}$/.test(relaySearchPcDigits) ? relaySearchPcDigits : null;
  const deliveryMode = o.delivery_mode === "home" ? "home" : "relay";
  const productRaw = typeof o.mr_relay_product === "string" ? o.mr_relay_product.trim().toUpperCase() : "24R";
  const relayProduct = RELAY_PRODUCTS.has(productRaw) ? productRaw : "24R";
  if (!itemId) {
    return NextResponse.json({ ok: false as const, error: "item_id requis" }, { status: 400 });
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
  const segnaSender = getSegnaRecipientFromEnv();
  if (!segnaSender) {
    return NextResponse.json({ ok: false as const, error: "Hub Segna incomplet (MONDR_SEGNA_RECIP_*)" }, { status: 501 });
  }

  const { data: item } = await admin
    .from("items")
    .select("id,title,status,price_points,owner_user_id,deleted_at,item_categories(name)")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.owner_user_id !== user.id || item.deleted_at != null) {
    return NextResponse.json({ ok: false as const, error: "Accès refusé" }, { status: 403 });
  }
  if (String(item.status) !== "retired") {
    return NextResponse.json({ ok: false as const, error: "La pièce doit être retirée (status retired) avant l'expédition retour." }, { status: 400 });
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

  const catEmb = item.item_categories as unknown;
  const catRow = Array.isArray(catEmb) ? catEmb[0] : catEmb;
  const catName = catRow && typeof catRow === "object" ? ((catRow as { name?: string | null }).name ?? null) : null;

  const memberRecipient: MrPerson = {
    Firstname: fn,
    Lastname: ln,
    Streetname: addr.sender_street,
    HouseNo: addr.sender_houseno,
    CountryCode: "FR",
    PostCode: addr.sender_postcode,
    City: addr.sender_city,
    PhoneNo: "",
    MobileNo: phone,
    Email: email,
  };

  const result = await performMrConnectShipment(config, {
    itemId,
    itemTitle: String(item.title ?? "").trim() || "Retour pièce Segna",
    sender: segnaSender,
    recipient: memberRecipient,
    parcelCount: 1,
    contentValueEur: item.price_points != null ? Math.max(0, Math.round(Number(item.price_points))) : null,
    weightGr: Math.max(1, defaultParcelWeightGramsFromCategory(catName)),
    lengthCm: DEFAULT_POUCH_LENGTH_CM,
    widthCm: DEFAULT_POUCH_WIDTH_CM,
    depthCm: DEFAULT_POUCH_DEPTH_CM,
    parcelContent: String(item.title ?? "").trim() || "Retour pièce Segna",
    deliveryInstructions: "Retour — livraison au membre (point relais ou domicile)",
    deliveryHome: deliveryMode === "home",
    relayLocation: deliveryMode === "relay" ? relayCode : null,
    collectionMode: "REL",
    relayDeliveryMode: relayProduct as "24R" | "24L" | "LCC" | "XOH",
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false as const, error: result.message.slice(0, 220) }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const { data: prevOuttake } = await admin.from("item_outtake").select("metadata").eq("item_id", itemId).maybeSingle();
  const prevMeta =
    prevOuttake?.metadata && typeof prevOuttake.metadata === "object" && !Array.isArray(prevOuttake.metadata)
      ? (prevOuttake.metadata as Record<string, unknown>)
      : {};
  const prevRelaySearchRaw =
    typeof prevMeta.return_relay_search_postal_code === "string" ? prevMeta.return_relay_search_postal_code.trim() : "";
  const prevRelaySearchOk = /^\d{5}$/.test(prevRelaySearchRaw) ? prevRelaySearchRaw : null;
  const nextMeta = {
    ...prevMeta,
    return_label_url: result.etiquetteLink,
    return_tracking_number: result.sendingNumber,
    return_relay_code: deliveryMode === "relay" ? relayCode : null,
    return_relay_label: deliveryMode === "relay" ? relayLabel || relayCode : null,
    return_relay_search_postal_code:
      deliveryMode === "relay" ? relaySearchPostal ?? prevRelaySearchOk : null,
    return_delivery_mode: deliveryMode,
    return_label_generated_at: nowIso,
  };
  const { error: outErr } = await admin
    .from("item_outtake")
    .upsert(
      {
        item_id: itemId,
        stage: "in_transit",
        metadata: nextMeta as unknown as never,
      },
      { onConflict: "item_id" },
    );
  if (outErr) {
    return NextResponse.json({ ok: false as const, error: outErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true as const,
    item_id: itemId,
    label_url: result.etiquetteLink,
    numero_suivi: result.sendingNumber,
  });
}
