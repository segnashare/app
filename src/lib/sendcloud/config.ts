export type SendcloudEnv = {
  publicKey: string;
  secretKey: string;
  panelBaseUrl: string;
  servicePointsBaseUrl: string;
  integrationId: number;
  senderAddressId: number | null;
  relayShippingMethodId: number | null;
  relayShippingOptionCode: string | null;
  checkoutConfigurationId: string | null;
  /** UUID méthode Dynamic Checkout « Livraison en Relais (Aller) » (panel → Copier l’ID de la méthode). */
  checkoutRelayDeliveryMethodId: string | null;
  /** UUID méthode DC livraison domicile Chronopost (ex. avant 18h). */
  checkoutHomeChronopostMethodId: string | null;
  /** UUID méthode DC livraison domicile standard. */
  checkoutHomeDomesticMethodId: string | null;
  fromCountry: string;
};

/** Titre DC affiché au checkout (stable après publication ; préféré à l’ID panel). */
const DEFAULT_CHECKOUT_RELAY_DELIVERY_METHOD_TITLE = "Livraison en Relais (Aller)";

export function getCheckoutRelayDeliveryMethodId(env: SendcloudEnv): string {
  return env.checkoutRelayDeliveryMethodId?.trim() ?? "";
}

export function getCheckoutRelayDeliveryMethodTitle(env: SendcloudEnv): string {
  return (
    process.env.SENDCLOUD_CHECKOUT_RELAY_DELIVERY_METHOD_TITLE?.trim() ||
    DEFAULT_CHECKOUT_RELAY_DELIVERY_METHOD_TITLE
  );
}

const DEFAULT_CHECKOUT_HOME_CHRONOPOST_METHOD_TITLE = "Chronopost";
const DEFAULT_CHECKOUT_HOME_DOMESTIC_METHOD_TITLE = "domicile";

function readEnvMethodId(...keys: string[]): string | null {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return null;
}

export function getCheckoutHomeChronopostMethodId(env: SendcloudEnv): string {
  return env.checkoutHomeChronopostMethodId?.trim() ?? "";
}

export function getCheckoutHomeDomesticMethodId(env: SendcloudEnv): string {
  return env.checkoutHomeDomesticMethodId?.trim() ?? "";
}

export function getCheckoutHomeChronopostMethodTitle(_env: SendcloudEnv): string {
  return (
    process.env.SENDCLOUD_CHECKOUT_HOME_CHRONOPOST_METHOD_TITLE?.trim() ||
    process.env.CHRONO_18_TITLE?.trim() ||
    DEFAULT_CHECKOUT_HOME_CHRONOPOST_METHOD_TITLE
  );
}

export function getCheckoutHomeDomesticMethodTitle(_env: SendcloudEnv): string {
  return (
    process.env.SENDCLOUD_CHECKOUT_HOME_DOMESTIC_METHOD_TITLE?.trim() ||
    process.env.HOME_DOMESTIC_TITLE?.trim() ||
    DEFAULT_CHECKOUT_HOME_DOMESTIC_METHOD_TITLE
  );
}

function parsePositiveInt(raw: string | undefined): number | null {
  const n = parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getSendcloudEnv(): SendcloudEnv | null {
  const publicKey = process.env.SENDCLOUD_PUBLIC_KEY?.trim() ?? "";
  const secretKey = process.env.SENDCLOUD_SECRET_KEY?.trim() ?? "";
  if (!publicKey || !secretKey) return null;

  const panelBaseUrl =
    (process.env.SENDCLOUD_PANEL_API_BASE_URL?.trim() || "https://panel.sendcloud.sc/api/v2").replace(
      /\/$/,
      "",
    );
  const servicePointsBaseUrl =
    (
      process.env.SENDCLOUD_SERVICE_POINTS_API_BASE_URL?.trim() ||
      "https://servicepoints.sendcloud.sc/api/v2"
    ).replace(/\/$/, "");

  const integrationId = parsePositiveInt(process.env.SENDCLOUD_INTEGRATION_ID);
  const senderAddressId = parsePositiveInt(process.env.SENDCLOUD_SENDER_ADDRESS_ID);
  const relayShippingMethodId = parsePositiveInt(process.env.SENDCLOUD_SHIPPING_METHOD_RELAY_ID);
  const relayShippingOptionCode =
    process.env.SENDCLOUD_SHIPPING_OPTION_RELAY?.trim() ||
    process.env.SENDCLOUD_SHIPPING_OPTION_CODE?.trim() ||
    null;

  const checkoutConfigurationId = process.env.SENDCLOUD_CHECKOUT_CONFIGURATION_ID?.trim() || null;
  const checkoutRelayDeliveryMethodId =
    process.env.SENDCLOUD_CHECKOUT_RELAY_DELIVERY_METHOD_ID?.trim() || null;
  const checkoutHomeChronopostMethodId = readEnvMethodId(
    "SENDCLOUD_CHECKOUT_HOME_CHRONOPOST_METHOD_ID",
    "CHRONO_18",
  );
  const checkoutHomeDomesticMethodId = readEnvMethodId(
    "SENDCLOUD_CHECKOUT_HOME_DOMESTIC_METHOD_ID",
    "HOME_DOMESTIC",
  );
  const fromCountry =
    process.env.SENDCLOUD_FROM_COUNTRY?.trim().toUpperCase().slice(0, 2) || "FR";

  return {
    publicKey,
    secretKey,
    panelBaseUrl,
    servicePointsBaseUrl,
    integrationId: integrationId ?? 0,
    senderAddressId,
    relayShippingMethodId,
    relayShippingOptionCode,
    checkoutConfigurationId,
    checkoutRelayDeliveryMethodId,
    checkoutHomeChronopostMethodId,
    checkoutHomeDomesticMethodId,
    fromCountry,
  };
}

export function isSendcloudRelaySearchEnabled(): boolean {
  if (process.env.SENDCLOUD_RELAY_SEARCH === "0") return false;
  return getSendcloudEnv() != null;
}

/** Widget carte Sendcloud (Service Point Picker) — défaut activé si clés présentes. */
export function isSendcloudServicePointPickerEnabled(): boolean {
  if (process.env.SENDCLOUD_SPP === "0") return false;
  return getSendcloudEnv() != null;
}

export function getSendcloudSppCarriersFromEnv(): string[] {
  const raw = process.env.SENDCLOUD_SPP_CARRIERS?.trim() || "mondial_relay,colissimo";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Tarifs checkout via Dynamic Checkout Sendcloud (sinon barème interne). */
export function isSendcloudCheckoutLivePricingEnabled(): boolean {
  if (process.env.SENDCLOUD_CHECKOUT_LIVE_PRICING === "0") return false;
  const env = getSendcloudEnv();
  return env != null && Boolean(env.checkoutConfigurationId);
}
