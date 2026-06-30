import type { CoursierEnvConfig } from "@/lib/coursier/config";
import { selectCoursierExpressOffer } from "@/lib/coursier/select-express-offer";
import type {
  CoursierAddress,
  CoursierGetPriceOffer,
  CoursierNormalizedExpressQuote,
  CoursierPackage,
} from "@/lib/coursier/types";

const GETPRICE_URL = "https://api.coursier.fr/v3/getprice.php";

function isCoursierErrorResponse(raw: unknown): raw is { Message: string } {
  return (
    raw != null &&
    typeof raw === "object" &&
    "Message" in raw &&
    typeof (raw as { Message?: unknown }).Message === "string"
  );
}

function normalizeOffer(raw: unknown): CoursierGetPriceOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const serviceId = typeof o.ServiceId === "string" ? o.ServiceId : String(o.ServiceId ?? "");
  const service = typeof o.Service === "string" ? o.Service : "";
  const pickupStartDate = typeof o.PickupStartDate === "string" ? o.PickupStartDate : "";
  const pickupEndDate = typeof o.PickupEndDate === "string" ? o.PickupEndDate : "";
  const deliveryStartDate = typeof o.DeliveryStartDate === "string" ? o.DeliveryStartDate : "";
  const deliveryEndDate = typeof o.DeliveryEndDate === "string" ? o.DeliveryEndDate : "";
  const price = typeof o.Price === "string" ? o.Price : String(o.Price ?? "");
  if (!serviceId || !service || !price) return null;
  return {
    ServiceId: serviceId,
    Service: service,
    PickupStartDate: pickupStartDate,
    PickupEndDate: pickupEndDate,
    DeliveryStartDate: deliveryStartDate,
    DeliveryEndDate: deliveryEndDate,
    Price: price,
  };
}

export async function fetchCoursierGetPriceOffers(params: {
  config: CoursierEnvConfig;
  fromAddress: CoursierAddress;
  toAddress: CoursierAddress;
  packages: CoursierPackage[];
  startDate?: string;
}): Promise<CoursierGetPriceOffer[]> {
  const body: Record<string, unknown> = {
    User: params.config.user,
    Apikey: params.config.apiKey,
    ClientId: params.config.clientId,
    FromAddress: params.fromAddress,
    ToAddress: params.toAddress,
    Packages: params.packages,
    Lang: params.config.lang,
  };
  if (params.startDate?.trim()) {
    body.StartDate = params.startDate.trim();
  }

  const res = await fetch(GETPRICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`coursier_getprice_${res.status}: ${rawText.slice(0, 600)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("coursier_getprice_invalid_json");
  }

  if (isCoursierErrorResponse(parsed)) {
    throw new Error(`coursier_getprice_error: ${parsed.Message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("coursier_getprice_unexpected_shape");
  }

  const offers = parsed.map(normalizeOffer).filter((o): o is CoursierGetPriceOffer => o != null);
  if (offers.length === 0) {
    throw new Error("coursier_getprice_empty");
  }

  return offers;
}

export async function fetchCoursierExpressQuote(params: {
  config: CoursierEnvConfig;
  fromAddress: CoursierAddress;
  toAddress: CoursierAddress;
  packages: CoursierPackage[];
  startDate?: string;
}): Promise<CoursierNormalizedExpressQuote> {
  const offers = await fetchCoursierGetPriceOffers(params);
  const selected = selectCoursierExpressOffer(offers);
  if (!selected) {
    throw new Error("coursier_getprice_no_express_offer");
  }

  const priceEuros = Number(selected.Price);
  if (!Number.isFinite(priceEuros) || priceEuros < 0) {
    throw new Error("coursier_getprice_invalid_price");
  }

  return {
    provider: "coursier",
    serviceId: selected.ServiceId,
    service: selected.Service,
    priceHtCents: Math.round(priceEuros * 100),
    pickupStartDate: selected.PickupStartDate,
    pickupEndDate: selected.PickupEndDate,
    deliveryStartDate: selected.DeliveryStartDate,
    deliveryEndDate: selected.DeliveryEndDate,
    offers,
  };
}
