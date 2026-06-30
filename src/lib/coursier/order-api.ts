import { postCoursierJson } from "@/lib/coursier/api-client";
import type { CoursierEnvConfig } from "@/lib/coursier/config";
import type { CoursierOrderAddress, CoursierOrderResponse, CoursierPackage } from "@/lib/coursier/types";

const ORDER_URL = "https://api.coursier.fr/v3/order.php";

function normalizeOrderResponse(raw: unknown): CoursierOrderResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("coursier_order_unexpected_shape");
  }
  const o = raw as Record<string, unknown>;
  const missionNumber =
    typeof o.MissionNumber === "string" ? o.MissionNumber : String(o.MissionNumber ?? "");
  if (!missionNumber.trim()) {
    throw new Error("coursier_order_missing_mission_number");
  }
  return {
    MissionNumber: missionNumber.trim(),
    PickupStartDate: typeof o.PickupStartDate === "string" ? o.PickupStartDate : "",
    PickupEndDate: typeof o.PickupEndDate === "string" ? o.PickupEndDate : "",
    DeliveryStartDate: typeof o.DeliveryStartDate === "string" ? o.DeliveryStartDate : "",
    DeliveryEndDate: typeof o.DeliveryEndDate === "string" ? o.DeliveryEndDate : "",
    price: typeof o.price === "number" || typeof o.price === "string" ? o.price : "",
    CO2: typeof o.CO2 === "number" || typeof o.CO2 === "string" ? o.CO2 : undefined,
  };
}

export function buildCoursierPickupOrderAddress(config: CoursierEnvConfig): CoursierOrderAddress {
  return {
    Company: config.pickupCompany,
    Address: config.pickupAddress.Address,
    PostalCode: config.pickupAddress.PostalCode,
    City: config.pickupAddress.City,
    Country: config.pickupAddress.Country,
    Contact: config.pickupContact,
    PhoneNumber: config.pickupPhone,
    ...(config.pickupEmail ? { Email: config.pickupEmail } : {}),
  };
}

export async function createCoursierOrder(params: {
  config: CoursierEnvConfig;
  serviceId: number;
  fromAddress: CoursierOrderAddress;
  toAddress: CoursierOrderAddress;
  packages: CoursierPackage[];
  startDate?: string;
  reference1?: string;
  reference2?: string;
  reference3?: string;
}): Promise<CoursierOrderResponse> {
  const body: Record<string, unknown> = {
    User: params.config.user,
    Apikey: params.config.apiKey,
    ClientId: params.config.clientId,
    ServiceId: params.serviceId,
    FromAddress: params.fromAddress,
    ToAddress: params.toAddress,
    Packages: params.packages,
    Lang: params.config.lang,
  };

  if (params.startDate?.trim()) body.StartDate = params.startDate.trim();
  if (params.reference1?.trim()) body.Reference1 = params.reference1.trim().slice(0, 50);
  if (params.reference2?.trim()) body.Reference2 = params.reference2.trim().slice(0, 50);
  if (params.reference3?.trim()) body.Reference3 = params.reference3.trim().slice(0, 50);

  const parsed = await postCoursierJson(ORDER_URL, body);
  return normalizeOrderResponse(parsed);
}
