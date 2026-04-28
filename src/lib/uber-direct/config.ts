export type UberDirectEnvConfig = {
  clientId: string;
  clientSecret: string;
  customerId: string;
  pickupName: string;
  pickupPhone: string;
  pickupLat: number;
  pickupLon: number;
  /** JSON string for `pickup_address` (Uber expects a serialized address object). */
  pickupAddressJson: string;
  /** If true, adds sandbox robo-courier (Uber test). */
  enableTestRoboCourier: boolean;
  /** Optionnel : si le membre n’a pas de téléphone en base, ce numéro (E.164) est utilisé pour Uber. */
  dropoffPhoneFallback: string | null;
};

function trimEnv(key: string): string {
  return (process.env[key] ?? "").trim();
}

function parseBool(v: string): boolean {
  return /^(1|true|yes|on)$/i.test(v);
}

/**
 * Lit la config Uber Direct côté serveur. Toutes les clés doivent être présentes
 * pour activer la création automatique de livraison après paiement.
 */
export function readUberDirectConfig(): UberDirectEnvConfig | null {
  const clientId = trimEnv("UBER_DIRECT_CLIENT_ID");
  const clientSecret = trimEnv("UBER_DIRECT_CLIENT_SECRET");
  const customerId = trimEnv("UBER_DIRECT_CUSTOMER_ID");
  const pickupName = trimEnv("UBER_DIRECT_PICKUP_NAME");
  const pickupPhone = trimEnv("UBER_DIRECT_PICKUP_PHONE");
  const pickupLatRaw = trimEnv("UBER_DIRECT_PICKUP_LAT");
  const pickupLonRaw = trimEnv("UBER_DIRECT_PICKUP_LON");
  const pickupAddressJson = trimEnv("UBER_DIRECT_PICKUP_ADDRESS_JSON");
  const dropoffPhoneFallbackRaw = trimEnv("UBER_DIRECT_DROPOFF_PHONE_FALLBACK");

  const pickupLat = Number(pickupLatRaw);
  const pickupLon = Number(pickupLonRaw);

  if (
    !clientId ||
    !clientSecret ||
    !customerId ||
    !pickupName ||
    !pickupPhone ||
    !pickupAddressJson ||
    !Number.isFinite(pickupLat) ||
    !Number.isFinite(pickupLon)
  ) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    customerId,
    pickupName,
    pickupPhone,
    pickupLat,
    pickupLon,
    pickupAddressJson,
    enableTestRoboCourier: parseBool(trimEnv("UBER_DIRECT_ENABLE_TEST_ROBO")),
    dropoffPhoneFallback: dropoffPhoneFallbackRaw || null,
  };
}
