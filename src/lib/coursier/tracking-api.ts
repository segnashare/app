import { postCoursierJson } from "@/lib/coursier/api-client";
import type { CoursierEnvConfig } from "@/lib/coursier/config";
import type { CoursierTrackingRow } from "@/lib/coursier/types";

const TRACKING_URL = "https://api.coursier.fr/v3/tracking.php";

function normalizeTrackingRow(raw: unknown): CoursierTrackingRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const missionNumber =
    typeof o.MissionNumber === "string" ? o.MissionNumber : String(o.MissionNumber ?? "");
  const state = typeof o.State === "string" ? o.State : "";
  if (!missionNumber.trim() || !state) return null;
  return {
    MissionId: typeof o.MissionId === "string" ? o.MissionId : String(o.MissionId ?? ""),
    MissionNumber: missionNumber.trim(),
    From: typeof o.From === "string" ? o.From : "",
    To: typeof o.To === "string" ? o.To : "",
    PickupStartDate: typeof o.PickupStartDate === "string" ? o.PickupStartDate : "",
    PickupEndDate: typeof o.PickupEndDate === "string" ? o.PickupEndDate : "",
    PickupStartEstimate: typeof o.PickupStartEstimate === "string" ? o.PickupStartEstimate : "",
    PickupEndEstimate: typeof o.PickupEndEstimate === "string" ? o.PickupEndEstimate : "",
    PickupDate: typeof o.PickupDate === "string" ? o.PickupDate : "",
    DeliveryStartDate: typeof o.DeliveryStartDate === "string" ? o.DeliveryStartDate : "",
    DeliveryEndDate: typeof o.DeliveryEndDate === "string" ? o.DeliveryEndDate : "",
    DeliveryStartEstimate: typeof o.DeliveryStartEstimate === "string" ? o.DeliveryStartEstimate : "",
    DeliveryEndEstimate: typeof o.DeliveryEndEstimate === "string" ? o.DeliveryEndEstimate : "",
    DeliveryDate: typeof o.DeliveryDate === "string" ? o.DeliveryDate : "",
    State: state,
    WorkerShortCode: typeof o.WorkerShortCode === "string" ? o.WorkerShortCode : "",
    WorkerSurname: typeof o.WorkerSurname === "string" ? o.WorkerSurname : "",
    Picture: typeof o.Picture === "string" ? o.Picture : "",
    ProofOfDelivery: typeof o.ProofOfDelivery === "string" ? o.ProofOfDelivery : "",
    DeliverySignee: typeof o.DeliverySignee === "string" ? o.DeliverySignee : "",
  };
}

export async function fetchCoursierTracking(params: {
  config: CoursierEnvConfig;
  missionNumber?: string;
}): Promise<CoursierTrackingRow[]> {
  const body: Record<string, unknown> = {
    User: params.config.user,
    Apikey: params.config.apiKey,
    ClientId: params.config.clientId,
    Lang: params.config.lang,
  };
  if (params.missionNumber?.trim()) {
    body.MissionNumber = params.missionNumber.trim();
  }

  const parsed = await postCoursierJson(TRACKING_URL, body);
  if (!Array.isArray(parsed)) {
    throw new Error("coursier_tracking_unexpected_shape");
  }

  return parsed.map(normalizeTrackingRow).filter((row): row is CoursierTrackingRow => row != null);
}
