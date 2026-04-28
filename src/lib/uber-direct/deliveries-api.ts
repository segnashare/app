import type { UberDirectEnvConfig } from "@/lib/uber-direct/config";
import { getUberDirectAccessToken } from "@/lib/uber-direct/oauth";

const API_BASE = "https://api.uber.com/v1/customers";

type ManifestItem = {
  name: string;
  quantity: number;
  weight: number;
  dimensions: { length: number; height: number; depth: number };
};

/** Réponse brute `POST …/delivery_quotes` (champs selon région / compte Uber). */
export async function fetchUberDeliveryQuoteRaw(params: {
  config: UberDirectEnvConfig;
  dropoffAddressJson: string;
}): Promise<Record<string, unknown>> {
  const token = await getUberDirectAccessToken(params.config);
  const url = `${API_BASE}/${params.config.customerId}/delivery_quotes`;
  const body = {
    pickup_address: params.config.pickupAddressJson,
    dropoff_address: params.dropoffAddressJson,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`uber_quote_${res.status}: ${raw.slice(0, 600)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("uber_quote_invalid_json");
  }

  const quoteId = typeof parsed.id === "string" ? parsed.id : "";
  if (!quoteId) {
    throw new Error("uber_quote_missing_id");
  }
  return parsed;
}

export async function createUberDeliveryQuote(params: {
  config: UberDirectEnvConfig;
  dropoffAddressJson: string;
}): Promise<{ quoteId: string }> {
  const parsed = await fetchUberDeliveryQuoteRaw(params);
  return { quoteId: parsed.id as string };
}

export async function createUberDelivery(params: {
  config: UberDirectEnvConfig;
  quoteId: string;
  dropoffAddressJson: string;
  dropoffName: string;
  dropoffPhone: string;
  /** Avec `quote_id`, omettre en général : Uber compare au géocodage du devis (évite « delivery location changed »). */
  dropoffLat?: number | null;
  dropoffLon?: number | null;
  dropoffNotes?: string;
  manifestItems: ManifestItem[];
  externalId: string;
}): Promise<{ id: string; trackingUrl?: string }> {
  const token = await getUberDirectAccessToken(params.config);
  const url = `${API_BASE}/${params.config.customerId}/deliveries`;

  const payload: Record<string, unknown> = {
    quote_id: params.quoteId,
    pickup_address: params.config.pickupAddressJson,
    pickup_name: params.config.pickupName,
    pickup_phone_number: params.config.pickupPhone,
    pickup_latitude: params.config.pickupLat,
    pickup_longitude: params.config.pickupLon,
    dropoff_address: params.dropoffAddressJson,
    dropoff_name: params.dropoffName,
    dropoff_phone_number: params.dropoffPhone,
    manifest_items: params.manifestItems,
    external_id: params.externalId,
  };

  const lat = params.dropoffLat;
  const lon = params.dropoffLon;
  if (
    lat != null &&
    lon != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    payload.dropoff_latitude = lat;
    payload.dropoff_longitude = lon;
  }

  if (params.dropoffNotes?.trim()) {
    payload.dropoff_notes = params.dropoffNotes.trim().slice(0, 280);
  }

  if (params.config.enableTestRoboCourier) {
    payload.test_specifications = {
      robo_courier_specification: { mode: "auto" },
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`uber_delivery_${res.status}: ${raw.slice(0, 600)}`);
  }

  const parsed = JSON.parse(raw) as { id?: string; tracking_url?: string };
  const id = typeof parsed.id === "string" ? parsed.id : "";
  if (!id) {
    throw new Error("uber_delivery_missing_id");
  }
  return { id, trackingUrl: typeof parsed.tracking_url === "string" ? parsed.tracking_url : undefined };
}
