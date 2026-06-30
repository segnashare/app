import type { SendcloudEnv } from "@/lib/sendcloud/config";
import { sendcloudPanelFetch, sendcloudPanelV3Fetch } from "@/lib/sendcloud/client";

export async function resolveRelayShippingOptionCode(
  env: SendcloudEnv,
  shippingMethodId: number,
): Promise<string | null> {
  if (env.relayShippingOptionCode) return env.relayShippingOptionCode;

  const res = await sendcloudPanelV3Fetch<{ data: Record<string, string | null> }>(
    env,
    "/compat/shipping-options",
    {
      method: "POST",
      body: JSON.stringify({ shipping_method_ids: [shippingMethodId] }),
    },
  );

  if (!res.ok) return null;
  const code = res.data.data?.[String(shippingMethodId)];
  return typeof code === "string" && code !== "null" ? code : null;
}

export async function pickDefaultRelayShippingMethodId(env: SendcloudEnv): Promise<number | null> {
  if (env.relayShippingMethodId) return env.relayShippingMethodId;

  const res = await sendcloudPanelFetch<{ shipping_methods: { id: number; name?: string; carrier?: string }[] }>(
    env,
    "/shipping_methods?sender_address=all",
    { method: "GET" },
  );
  if (!res.ok) return null;

  const methods = res.data.shipping_methods ?? [];
  const relay = methods.find(
    (m: { id: number; name?: string; carrier?: string }) =>
      m.carrier === "mondial_relay" &&
      typeof m.name === "string" &&
      /point relais/i.test(m.name) &&
      /0\.5-1kg/i.test(m.name) &&
      !/international/i.test(m.name),
  );
  return relay?.id ?? null;
}

/** Méthode point relais / service point pour un transporteur (0,5–1 kg FR, hors international). */
export async function pickRelayShippingMethodIdForCarrier(
  env: SendcloudEnv,
  carrier: string,
): Promise<number | null> {
  const c = carrier.trim().toLowerCase();
  if (!c) return null;

  const res = await sendcloudPanelFetch<{ shipping_methods: { id: number; name?: string; carrier?: string }[] }>(
    env,
    "/shipping_methods?sender_address=all",
    { method: "GET" },
  );
  if (!res.ok) return null;

  const methods = res.data.shipping_methods ?? [];
  const relay = methods.find(
    (m: { id: number; name?: string; carrier?: string }) =>
      m.carrier === c &&
      typeof m.name === "string" &&
      (/point relais|service point|parcel shop|relais/i.test(m.name)) &&
      /0\.5-1|0-1|0\.25-0\.5/i.test(m.name) &&
      !/international/i.test(m.name),
  );
  if (relay?.id) return relay.id;

  const fallback = methods.find(
    (m: { id: number; name?: string; carrier?: string }) =>
      m.carrier === c &&
      typeof m.name === "string" &&
      /point relais|service point|relais/i.test(m.name) &&
      !/international/i.test(m.name),
  );
  return fallback?.id ?? null;
}

/**
 * Méthode panel retour pour un transporteur donné (0,5–1 kg FR).
 * - chronopost → Shop2Shop
 * - mondial_relay → Locker, puis point relais
 */
export async function pickReturnShippingMethodIdForCarrier(
  env: SendcloudEnv,
  carrierSlug: string,
): Promise<number | null> {
  const c = carrierSlug.trim().toLowerCase();
  if (!c) return null;

  const res = await sendcloudPanelFetch<{ shipping_methods: { id: number; name?: string; carrier?: string }[] }>(
    env,
    "/shipping_methods?sender_address=all",
    { method: "GET" },
  );
  if (!res.ok) return null;

  const methods = res.data.shipping_methods ?? [];

  if (c === "chronopost" || c.includes("chrono")) {
    const chrono = methods.find(
      (m) =>
        m.carrier === "chronopost" &&
        typeof m.name === "string" &&
        /shop2shop/i.test(m.name) &&
        /0\.5-1/i.test(m.name) &&
        !/international/i.test(m.name),
    );
    if (chrono?.id) return chrono.id;
    return pickRelayShippingMethodIdForCarrier(env, "chronopost");
  }

  if (c === "mondial_relay" || c.includes("mondial")) {
    const locker = methods.find(
      (m) =>
        m.carrier === "mondial_relay" &&
        typeof m.name === "string" &&
        /locker/i.test(m.name) &&
        /0\.5-1/i.test(m.name) &&
        !/international/i.test(m.name),
    );
    if (locker?.id) return locker.id;
    return pickRelayShippingMethodIdForCarrier(env, "mondial_relay");
  }

  return pickRelayShippingMethodIdForCarrier(env, c);
}

type ReturnCarrierPreference = "chronopost" | "mondial_relay";

function readReturnCarrierPreference(): ReturnCarrierPreference {
  const raw = (process.env.SENDCLOUD_RETURN_CARRIER_PREFERENCE ?? "chronopost").trim().toLowerCase();
  if (raw === "mondial_relay" || raw === "mr" || raw === "locker") return "mondial_relay";
  return "chronopost";
}

/**
 * Méthode panel pour retours panier (0,5–1 kg) :
 * - chronopost : Chrono Shop2Shop (point relais)
 * - mondial_relay : Locker Delivery
 */
export async function pickReturnShippingMethodId(env: SendcloudEnv): Promise<number | null> {
  const preference = readReturnCarrierPreference();
  const carriers: ReturnCarrierPreference[] =
    preference === "mondial_relay" ? ["mondial_relay", "chronopost"] : ["chronopost", "mondial_relay"];

  const res = await sendcloudPanelFetch<{ shipping_methods: { id: number; name?: string; carrier?: string }[] }>(
    env,
    "/shipping_methods?sender_address=all",
    { method: "GET" },
  );
  if (!res.ok) return null;

  const methods = res.data.shipping_methods ?? [];

  for (const carrier of carriers) {
    if (carrier === "chronopost") {
      const chrono = methods.find(
        (m) =>
          m.carrier === "chronopost" &&
          typeof m.name === "string" &&
          /shop2shop/i.test(m.name) &&
          /0\.5-1/i.test(m.name) &&
          !/international/i.test(m.name),
      );
      if (chrono?.id) return chrono.id;
    }
    if (carrier === "mondial_relay") {
      const locker = methods.find(
        (m) =>
          m.carrier === "mondial_relay" &&
          typeof m.name === "string" &&
          /locker/i.test(m.name) &&
          /0\.5-1/i.test(m.name) &&
          !/international/i.test(m.name),
      );
      if (locker?.id) return locker.id;
      const relay = methods.find(
        (m) =>
          m.carrier === "mondial_relay" &&
          typeof m.name === "string" &&
          (/point relais|service point/i.test(m.name)) &&
          /0\.5-1/i.test(m.name) &&
          !/international/i.test(m.name),
      );
      if (relay?.id) return relay.id;
    }
  }

  return null;
}

function normMethodLabel(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Méthode panel livraison à domicile (hors point relais / Shop2Shop). */
export async function pickHomeShippingMethodIdFromPanel(env: SendcloudEnv): Promise<number | null> {
  const raw = process.env.SENDCLOUD_SHIPPING_METHOD_HOME_ID?.trim();
  const fromEnv = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  const res = await sendcloudPanelFetch<{ shipping_methods: { id: number; name?: string; carrier?: string }[] }>(
    env,
    "/shipping_methods?sender_address=all",
    { method: "GET" },
  );
  if (!res.ok) return null;

  const methods = res.data.shipping_methods ?? [];
  const home = methods.find((m) => {
    const name = normMethodLabel(String(m.name ?? ""));
    const carrier = normMethodLabel(String(m.carrier ?? ""));
    if (/international/.test(name)) return false;
    if (/point relais|service point|parcel shop|relais|shop2shop|shop 2 shop|pickup/.test(name)) {
      return false;
    }
    const weightOk = /0\.5|0,5|0-1|0\.25/.test(name) || name.includes("kg");
    if (!weightOk) return false;
    return (
      /domicile|home|door|standard|chrono|18/.test(name) ||
      (carrier.includes("chronopost") && !/relais|shop/.test(name)) ||
      carrier.includes("colissimo")
    );
  });
  return home?.id ?? null;
}

export async function resolveShippingOptionCodeForMethodId(
  env: SendcloudEnv,
  shippingMethodId: number,
): Promise<string | null> {
  return resolveRelayShippingOptionCode(env, shippingMethodId);
}

export async function resolveRelayShippingOptionForCarrier(
  env: SendcloudEnv,
  carrier: string,
): Promise<string | null> {
  const c = carrier.trim().toLowerCase();
  if (c === "mondial_relay" && env.relayShippingOptionCode) {
    return env.relayShippingOptionCode;
  }
  const methodId = await pickRelayShippingMethodIdForCarrier(env, c);
  if (!methodId) return null;
  return resolveRelayShippingOptionCode(env, methodId);
}
