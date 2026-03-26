import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_POUCH_DEPTH_CM,
  DEFAULT_POUCH_LENGTH_CM,
  DEFAULT_POUCH_WIDTH_CM,
  defaultParcelWeightGramsFromCategory,
} from "@/lib/mondial-relay/category-parcel-defaults";
import { getMondialRelayConnectEnv, getMondialRelaySoapEnv } from "@/lib/mondial-relay/config";
import { performMrConnectShipment } from "@/lib/mondial-relay/mr-perform-connect";
import { parseMemberAdressForShipment } from "@/lib/mondial-relay/parse-member-address";
import { getSegnaRecipientFromEnv } from "@/lib/mondial-relay/segna-recipient-env";
import { filterRelayHitsByPlanTri } from "@/lib/mondial-relay/soap-plan-tri-pretri";
import { searchRelayPointsSoap } from "@/lib/mondial-relay/soap-point-relais-search";
import type { MrPerson } from "@/lib/mondial-relay/shipment-xml";

import { patchItemIntakeMondialRelayMetadata } from "@/lib/items/item-intake-mr-patch";

const DEFAULT_MAX_RELAYS = 25;
const DELAY_MS_BETWEEN_RELAY_ATTEMPTS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Affiché côté client quand l’API renvoie 501 (variables d’environnement manquantes sur segna-app). */
export const MR_AUTO_GENERATE_ENV_HINT =
  "Sur le serveur de l’app membre, copie dans segna-app/.env.local les mêmes variables que sur le back-office : MONDR_CONNECT_API_BASE_URL, MONDR_CONNECT_BRAND_ID, MONDR_CONNECT_API_LOGIN, MONDR_CONNECT_API_PASSWORD ; MONDR_RELAY_SOAP_ENSEIGNE et MONDR_RELAY_SOAP_PRIVATE_KEY ; toutes les MONDR_SEGNA_RECIP_* (hub). Redémarre ensuite le serveur Next.";

export function mergeOrderSuffix(sortedIds: string[]): string {
  const h = createHash("sha256").update(sortedIds.join("|")).digest("hex").slice(0, 8);
  return `-mg${h}`;
}

type ItemRow = {
  id: string;
  title: string | null;
  price_points: number | null;
  owner_user_id: string;
  deleted_at: string | null;
  item_categories: { name: string | null } | { name: string | null }[] | null;
  item_intake:
    | { listing_stage: string; fulfillment_stage: string | null; metadata?: unknown }
    | { listing_stage: string; fulfillment_stage: string | null; metadata?: unknown }[]
    | null;
};

function unwrapIntake(emb: ItemRow["item_intake"]) {
  if (!emb) return null;
  const row = Array.isArray(emb) ? emb[0] : emb;
  if (!row || typeof row !== "object") return null;
  return row;
}

function aggregateParcel(rows: ItemRow[]): {
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
  const contentLabel = titles.length > 0 ? titles.join(" · ").slice(0, 200) : "Envoi Segna";
  return {
    weightG: Math.max(1, weightG),
    valueEur: Math.max(0, valueEur),
    contentLabel,
    lengthCm: DEFAULT_POUCH_LENGTH_CM,
    widthCm: DEFAULT_POUCH_WIDTH_CM,
    depthCm: DEFAULT_POUCH_DEPTH_CM,
  };
}

async function recordMemberMrFailure(service: SupabaseClient, ids: string[], msg: string) {
  const iso = new Date().toISOString();
  const short = msg.slice(0, 400);
  for (const id of ids) {
    await patchItemIntakeMondialRelayMetadata(service, id, {
      last_member_mr_error_at: iso,
      last_member_mr_error_message: short,
    });
  }
}

export async function runMemberMrAutoGenerate(
  service: SupabaseClient,
  params: { userId: string; itemIds: string[] },
): Promise<
  | { ok: true; label_url: string; numero_suivi: string; item_ids: string[] }
  | { ok: false; error: string; status: number; developerHint?: string }
> {
  const sortedIds = [...new Set(params.itemIds.map((x) => x.trim()).filter(Boolean))].sort();
  if (sortedIds.length < 1 || sortedIds.length > 5) {
    return { ok: false, error: "Entre 1 et 5 pièces requises.", status: 400 };
  }

  const config = getMondialRelayConnectEnv();
  if (!config) {
    return {
      ok: false,
      error: "Expédition automatique indisponible : l’app n’a pas les identifiants Mondial Relay Connect (MONDR_CONNECT_*).",
      status: 501,
      developerHint: MR_AUTO_GENERATE_ENV_HINT,
    };
  }
  const recipient = getSegnaRecipientFromEnv();
  if (!recipient) {
    return {
      ok: false,
      error: "Configuration hub Segna incomplète sur ce serveur (MONDR_SEGNA_RECIP_*).",
      status: 501,
      developerHint: MR_AUTO_GENERATE_ENV_HINT,
    };
  }
  const soap = getMondialRelaySoapEnv();
  if (!soap) {
    return {
      ok: false,
      error: "Recherche de relais indisponible : il manque la config SOAP MR (MONDR_RELAY_SOAP_ENSEIGNE / MONDR_RELAY_SOAP_PRIVATE_KEY).",
      status: 501,
      developerHint: MR_AUTO_GENERATE_ENV_HINT,
    };
  }

  const { data: rows, error: qerr } = await service
    .from("items")
    .select(
      "id,title,price_points,owner_user_id,deleted_at, item_categories(name), item_intake(listing_stage,fulfillment_stage,metadata)",
    )
    .in("id", sortedIds);

  if (qerr || !rows || rows.length !== sortedIds.length) {
    return { ok: false, error: "Pièce introuvable ou accès refusé.", status: 403 };
  }

  const typed = rows as unknown as ItemRow[];
  for (const r of typed) {
    if (r.owner_user_id !== params.userId || r.deleted_at != null) {
      return { ok: false, error: "Accès refusé à au moins une pièce.", status: 403 };
    }
    const intake = unwrapIntake(r.item_intake);
    if (!intake || String(intake.listing_stage) !== "validated" || String(intake.fulfillment_stage ?? "") !== "shipping") {
      return {
        ok: false,
        error: "Une pièce n'est pas en phase expédition (validée + livraison à préparer).",
        status: 400,
      };
    }
  }

  const { data: member, error: memErr } = await service
    .from("users")
    .select("first_name,last_name,email,phone,adress")
    .eq("id", params.userId)
    .maybeSingle();
  if (memErr || !member) {
    return { ok: false, error: "Profil membre introuvable.", status: 400 };
  }

  const fn = (member.first_name as string | null | undefined)?.trim();
  const ln = (member.last_name as string | null | undefined)?.trim();
  const email = (member.email as string | null | undefined)?.trim();
  const phone = String((member.phone as string | null | undefined) ?? "")
    .replace(/\s/g, "")
    .trim();
  if (!fn || !ln || !email || !phone) {
    return { ok: false, error: "Complète prénom, nom, email et téléphone dans ton profil.", status: 400 };
  }

  const addr = parseMemberAdressForShipment((member.adress as string | null | undefined) ?? null);
  if (!addr?.sender_street || !addr.sender_houseno || !addr.sender_postcode || !addr.sender_city) {
    return { ok: false, error: "Complète ton adresse postale dans ton profil (rue, n°, CP, ville).", status: 400 };
  }

  const parcel = aggregateParcel(typed);
  const postcode = addr.sender_postcode.trim();
  const country = (addr.sender_country?.trim().toUpperCase() || "FR").slice(0, 2);

  let points: Awaited<ReturnType<typeof searchRelayPointsSoap>>["points"];
  try {
    const res = await searchRelayPointsSoap(soap, {
      country,
      postalCode: postcode,
      weightGrams: parcel.weightG,
      action: "24R",
    });
    points = res.points;
    const hub = getSegnaRecipientFromEnv();
    if (hub && points.length > 0) {
      const { kept } = await filterRelayHitsByPlanTri(soap, points, {
        modeLiv: "24R",
        destPostcode: hub.PostCode,
        destCountry: hub.CountryCode,
      });
      points = kept;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur recherche relais";
    await recordMemberMrFailure(service, sortedIds, msg);
    return { ok: false, error: msg.slice(0, 200), status: 502 };
  }

  if (!points.length) {
    const msg = "Aucun point relais compatible près de ton adresse pour ce colis.";
    await recordMemberMrFailure(service, sortedIds, msg);
    return { ok: false, error: msg, status: 422 };
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
    const msg = "Aucun point relais exploitable après filtrage.";
    await recordMemberMrFailure(service, sortedIds, msg);
    return { ok: false, error: msg, status: 422 };
  }

  const sender: MrPerson = {
    Firstname: fn,
    Lastname: ln,
    Streetname: addr.sender_street,
    HouseNo: addr.sender_houseno,
    CountryCode: country.length === 2 ? country : "FR",
    PostCode: postcode,
    City: addr.sender_city,
    PhoneNo: "",
    MobileNo: phone,
    Email: email,
  };

  const single = sortedIds.length === 1;
  const primaryId = sortedIds[0]!;
  const primaryTitle =
    String(typed.find((x) => x.id === primaryId)?.title ?? "").trim() || "Piece Segna";
  const mergeBaseSuffix = mergeOrderSuffix(sortedIds);

  const attempts: { code: string; error: string }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!;
    if (i > 0) {
      await sleep(DELAY_MS_BETWEEN_RELAY_ATTEMPTS);
    }

    const orderNoSuffix = single
      ? i > 0
        ? `-r${i}`
        : undefined
      : i > 0
        ? `${mergeBaseSuffix}-r${i}`
        : mergeBaseSuffix;

    let result;
    try {
      result = await performMrConnectShipment(config, {
        itemId: primaryId,
        itemTitle: single ? primaryTitle : parcel.contentLabel.slice(0, 200),
        sender,
        recipient,
        parcelCount: 1,
        contentValueEur: parcel.valueEur > 0 ? parcel.valueEur : 100,
        weightGr: parcel.weightG,
        lengthCm: parcel.lengthCm,
        widthCm: parcel.widthCm,
        depthCm: parcel.depthCm,
        parcelContent: parcel.contentLabel,
        deliveryInstructions: single ? undefined : `Fusion membre — ${sortedIds.length} pièce(s).`,
        deliveryHome: false,
        relayLocation: cand.code,
        collectionMode: "REL",
        relayDeliveryMode: "24R",
        orderNoSuffix,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur étiquette";
      attempts.push({ code: cand.code, error: msg.slice(0, 200) });
      continue;
    }

    if (!result.ok) {
      attempts.push({ code: cand.code, error: result.message.slice(0, 200) });
      continue;
    }

    const metaNotes = single
      ? [
          `MR Connect auto membre : étiquette après essais multi-relais (${i + 1}/${candidates.length})`,
          `Relais: ${cand.label}`,
        ]
          .join(" · ")
          .slice(0, 2000)
      : [
          `MR Connect fusion auto membre (${i + 1}/${candidates.length}) — ${sortedIds.length} pièces`,
          `Relais: ${cand.label}`,
        ]
          .join(" · ")
          .slice(0, 2000);

    const removeKeys = [
      "last_member_mr_error_at",
      "last_member_mr_error_message",
      ...(single ? (["mr_merge_item_ids"] as const) : []),
    ];

    for (const id of sortedIds) {
      const patchRes = await patchItemIntakeMondialRelayMetadata(
        service,
        id,
        {
          label_url: result.etiquetteLink,
          numero_suivi: result.sendingNumber,
          reference_expedition: result.sendingNumber,
          notes_interne: metaNotes,
          last_backoffice_update_at: new Date().toISOString(),
          ...(single ? {} : { mr_merge_item_ids: sortedIds.join(",") }),
        },
        { removeKeys: [...removeKeys] },
      );
      if (!patchRes.ok) {
        return { ok: false, error: patchRes.message, status: 500 };
      }
    }

    return {
      ok: true,
      label_url: result.etiquetteLink,
      numero_suivi: result.sendingNumber,
      item_ids: sortedIds,
    };
  }

  const summary = attempts.map((a) => `${a.code}: ${a.error}`).join(" | ").slice(0, 1800);
  const iso = new Date().toISOString();
  const shortErr = `Aucun relais du CP n’a permis de créer l’étiquette (${attempts.length} essais). Dernier : ${attempts[attempts.length - 1]?.error ?? ""}`;
  for (const id of sortedIds) {
    await patchItemIntakeMondialRelayMetadata(service, id, {
      last_member_mr_error_at: iso,
      last_member_mr_error_message: shortErr.slice(0, 400),
      notes_interne: `MR auto membre multi-relais: aucun succès (${attempts.length}). ${summary}`.slice(0, 2000),
      last_backoffice_update_at: iso,
    });
  }
  return { ok: false, error: shortErr.slice(0, 280), status: 502 };
}
