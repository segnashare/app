import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";
import { getIntakeReturnPortalReasonId } from "@/lib/sendcloud/return-portal-api";
import {
  pickHomeShippingMethodIdFromPanel,
  resolveShippingOptionCodeForMethodId,
} from "@/lib/sendcloud/shipping-options";
import type { SendcloudOutboundRecipient } from "@/lib/sendcloud/shipments";

const DEFAULT_DUMMY_CANCEL_AFTER_MS = 10 * 60 * 1000;

/** Délai avant annulation auto de l’expédition technique (défaut 10 min). */
export function intakeReturnPortalCancelAfterMs(): number {
  const minutesRaw = process.env.SENDCLOUD_INTAKE_DUMMY_CANCEL_MINUTES?.trim();
  if (minutesRaw) {
    const m = parseFloat(minutesRaw);
    if (Number.isFinite(m) && m > 0) return Math.round(m * 60 * 1000);
  }
  const hoursRaw = process.env.SENDCLOUD_INTAKE_DUMMY_CANCEL_HOURS?.trim();
  if (hoursRaw) {
    const h = parseFloat(hoursRaw);
    if (Number.isFinite(h) && h > 0) return Math.round(h * 60 * 60 * 1000);
  }
  return DEFAULT_DUMMY_CANCEL_AFTER_MS;
}

export function intakeReturnPortalCancelAfterMinutes(): number {
  return Math.max(1, Math.round(intakeReturnPortalCancelAfterMs() / 60_000));
}

function addressNode(recipient: SendcloudOutboundRecipient): Record<string, string> {
  return {
    name: recipient.name.slice(0, 64),
    company_name: "",
    address_line_1: recipient.addressLine1.slice(0, 64),
    house_number: recipient.houseNumber.slice(0, 16) || "1",
    postal_code: recipient.postalCode,
    city: recipient.city.slice(0, 64),
    country_code: recipient.countryCode.toUpperCase(),
    phone_number: recipient.phone.slice(0, 32),
    email: recipient.email.slice(0, 128),
  };
}

const RETURN_PORTAL_PREFILL_PARAMS = [
  "identifier",
  "order_number",
  "postal_code",
  "zip",
  "return_reason_id",
  "reason_id",
] as const;

/** URL de base du portail (sans préremplissage commande / CP) — réutilisable après réinitialisation. */
export function stripReturnPortalUrlToBase(url: string): string {
  try {
    const u = new URL(url.trim());
    for (const key of RETURN_PORTAL_PREFILL_PARAMS) {
      u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url.trim();
  }
}

/** Préremplit n° de commande / identifiant et CP sur l’URL du portail retour Sendcloud. */
export function buildReturnPortalUrlWithPrefill(
  baseUrl: string,
  params: { orderNumber: string; postalCode: string; identifier?: string | null },
): string {
  try {
    const u = new URL(baseUrl);
    const order = params.orderNumber.trim();
    const identifier = (params.identifier ?? order).trim();
    if (identifier) {
      u.searchParams.set("identifier", identifier);
      u.searchParams.set("order_number", order);
    }
    const pc = params.postalCode.replace(/\D/g, "").slice(0, 5);
    if (pc.length === 5) {
      u.searchParams.set("postal_code", pc);
      u.searchParams.set("zip", pc);
    }
    const reasonId = getIntakeReturnPortalReasonId();
    u.searchParams.set("return_reason_id", String(reasonId));
    u.searchParams.set("reason_id", String(reasonId));
    return u.toString();
  } catch {
    return baseUrl;
  }
}

type AnnounceResult =
  | { ok: true; shipmentId: string; parcelId: number | null; trackingNumber: string | null }
  | { ok: false; error: string; sendcloudStatus?: number; sendcloudRaw?: unknown };

function buildDummyOutboundBody(
  input: {
    orderNumber: string;
    toRecipient: SendcloudOutboundRecipient;
    senderAddressId: number;
    weightKg: string;
  },
  shipWith?: { shipping_option_code: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    apply_shipping_defaults: true,
    apply_shipping_rules: true,
    order_number: input.orderNumber,
    total_order_price: { currency: "EUR", value: "1.00" },
    to_address: addressNode(input.toRecipient),
    from_address: { sender_address_id: input.senderAddressId },
    parcels: [
      {
        weight: { value: input.weightKg, unit: "kg" },
        dimensions: { length: "30", width: "20", height: "10", unit: "cm" },
      },
    ],
    label_details: { mime_type: "application/pdf", dpi: 72 },
  };
  if (shipWith) {
    body.ship_with = {
      type: "shipping_option_code",
      properties: { shipping_option_code: shipWith.shipping_option_code },
    };
    delete body.apply_shipping_rules;
  }
  return body;
}

async function announceDummyOutbound(
  env: SendcloudEnv,
  body: Record<string, unknown>,
): Promise<AnnounceResult> {
  const paths = ["/shipments/announce-with-shipping-rules", "/shipments/announce"] as const;
  let last: AnnounceResult = { ok: false, error: "Annonce Sendcloud impossible." };

  for (const path of paths) {
    const res = await sendcloudPanelV3Fetch<{
      data: { id?: string; parcels?: Array<{ id?: number; tracking_number?: string }> };
    }>(env, path, { method: "POST", body: JSON.stringify(body) });

    if (!res.ok) {
      last = {
        ok: false,
        error: res.error,
        sendcloudStatus: res.status,
        sendcloudRaw: res.raw,
      };
      continue;
    }

    const shipmentId = String(res.data.data?.id ?? "").trim();
    const parcelId = res.data.data?.parcels?.[0]?.id;
    const trackingNumber = String(res.data.data?.parcels?.[0]?.tracking_number ?? "").trim();
    if (!shipmentId) {
      last = { ok: false, error: "Sendcloud : expédition créée sans identifiant." };
      continue;
    }
    return {
      ok: true,
      shipmentId,
      parcelId: typeof parcelId === "number" && parcelId > 0 ? parcelId : null,
      trackingNumber: trackingNumber || null,
    };
  }

  return last;
}

/**
 * Expédition technique Segna → adresse membre pour activer le portail retour.
 * Par défaut : règles Sendcloud (pas d’option choisie). Secours : option panel si les règles échouent.
 */
export async function createDummyOutboundShipmentForReturnPortal(
  env: SendcloudEnv,
  input: {
    orderNumber: string;
    toRecipient: SendcloudOutboundRecipient;
    senderAddressId: number;
  },
): Promise<AnnounceResult> {
  const weightCandidates = ["1.0", "0.75", "0.50"];

  for (const weightKg of weightCandidates) {
    const body = buildDummyOutboundBody({ ...input, weightKg });
    const res = await announceDummyOutbound(env, body);
    if (res.ok) {
      console.info("[return-portal] dummy outbound created (shipping rules)", {
        orderNumber: input.orderNumber,
        weightKg,
        shipmentId: res.shipmentId,
      });
      return res;
    }
    if (!res.error.toLowerCase().includes("no shipping option")) {
      console.error("[return-portal] dummy outbound announce failed", {
        orderNumber: input.orderNumber,
        weightKg,
        mode: "shipping_rules",
        sendcloudStatus: res.sendcloudStatus,
        error: res.error,
        raw: res.sendcloudRaw,
      });
      return res;
    }
  }

  const explicit = process.env.SENDCLOUD_SHIPPING_OPTION_RETURN_PORTAL_DUMMY?.trim();
  let fallbackCode = explicit || null;
  if (!fallbackCode) {
    const methodId = await pickHomeShippingMethodIdFromPanel(env);
    if (methodId) {
      fallbackCode = await resolveShippingOptionCodeForMethodId(env, methodId);
    }
  }

  if (fallbackCode) {
    const body = buildDummyOutboundBody(
      { ...input, weightKg: "1.0" },
      { shipping_option_code: fallbackCode },
    );
    const res = await announceDummyOutbound(env, body);
    if (res.ok) {
      console.info("[return-portal] dummy outbound created (fallback option)", {
        orderNumber: input.orderNumber,
        shipmentId: res.shipmentId,
      });
      return res;
    }
    console.error("[return-portal] dummy outbound fallback failed", {
      orderNumber: input.orderNumber,
      fallbackCode,
      sendcloudStatus: res.sendcloudStatus,
      error: res.error,
      raw: res.sendcloudRaw,
    });
    return res;
  }

  return {
    ok: false,
    error:
      "Sendcloud n’a pas trouvé de transporteur par défaut pour cette adresse. Configure une règle d’expédition domicile dans Sendcloud ou SENDCLOUD_SHIPPING_OPTION_RETURN_PORTAL_DUMMY.",
  };
}

export async function fetchSendcloudReturnPortalUrl(
  env: SendcloudEnv,
  shipmentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const id = shipmentId.trim();
  if (!id) return { ok: false, error: "Identifiant expédition manquant." };

  const res = await sendcloudPanelV3Fetch<{ data: { url?: string } }>(
    env,
    `/shipments/${encodeURIComponent(id)}/return-portal-url`,
    { method: "GET" },
  );
  if (!res.ok) {
    if (res.status === 404) {
      return {
        ok: false,
        error:
          "Portail retour indisponible pour cette expédition. L’expédition doit utiliser une adresse expéditeur Sendcloud (SENDCLOUD_SENDER_ADDRESS_ID).",
      };
    }
    return { ok: false, error: res.error };
  }

  const url = String(res.data.data?.url ?? "").trim();
  if (!url.startsWith("http")) {
    return {
      ok: false,
      error:
        "Portail retour non configuré sur Sendcloud (aucune URL). Vérifie la marque / le portail retours.",
    };
  }
  return { ok: true, url };
}

export async function cancelSendcloudShipment(
  env: SendcloudEnv,
  shipmentId: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const id = shipmentId.trim();
  if (!id) return { ok: false, error: "Identifiant expédition manquant." };

  const res = await sendcloudPanelV3Fetch<{ data: { status?: string; message?: string } }>(
    env,
    `/shipments/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!res.ok) {
    if (res.status === 409) {
      return { ok: true, status: "already_cancelled" };
    }
    return { ok: false, error: res.error };
  }
  return { ok: true, status: String(res.data.data?.status ?? "cancelled") };
}
