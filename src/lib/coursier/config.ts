import type { CoursierAddress } from "@/lib/coursier/types";

export type CoursierEnvConfig = {
  user: string;
  apiKey: string;
  clientId: string;
  pickupAddress: CoursierAddress;
  pickupCompany: string;
  pickupContact: string;
  pickupPhone: string;
  pickupEmail: string | null;
  lang: string;
  /** Si le membre n’a pas de téléphone en base. */
  dropoffPhoneFallback: string | null;
};

function trimEnv(key: string): string {
  return (process.env[key] ?? "").trim();
}

/**
 * Lit la config Coursier.fr côté serveur (Devis / Order / Tracking V3).
 * Toutes les clés requises doivent être présentes pour activer le flux express.
 */
export function readCoursierConfig(): CoursierEnvConfig | null {
  const user = trimEnv("COURSIER_USER");
  const apiKey = trimEnv("COURSIER_APIKEY");
  const clientId = trimEnv("COURSIER_CLIENT_ID");
  const pickupStreet = trimEnv("COURSIER_PICKUP_ADDRESS");
  const pickupPostalCode = trimEnv("COURSIER_PICKUP_POSTAL_CODE");
  const pickupCity = trimEnv("COURSIER_PICKUP_CITY");
  const pickupCountry = trimEnv("COURSIER_PICKUP_COUNTRY") || "France";
  const pickupCompany = trimEnv("COURSIER_PICKUP_COMPANY");
  const pickupContact = trimEnv("COURSIER_PICKUP_CONTACT");
  const pickupPhone = trimEnv("COURSIER_PICKUP_PHONE");
  const pickupEmailRaw = trimEnv("COURSIER_PICKUP_EMAIL");
  const dropoffPhoneFallbackRaw = trimEnv("COURSIER_DROPOFF_PHONE_FALLBACK");
  const lang = trimEnv("COURSIER_LANG") || "FR";

  if (
    !user ||
    !apiKey ||
    !clientId ||
    !pickupStreet ||
    !pickupPostalCode ||
    !pickupCity ||
    !pickupCompany ||
    !pickupContact ||
    !pickupPhone
  ) {
    return null;
  }

  return {
    user,
    apiKey,
    clientId,
    pickupAddress: {
      Address: pickupStreet,
      PostalCode: pickupPostalCode,
      City: pickupCity,
      Country: pickupCountry,
    },
    pickupCompany,
    pickupContact,
    pickupPhone,
    pickupEmail: pickupEmailRaw || null,
    lang,
    dropoffPhoneFallback: dropoffPhoneFallbackRaw || null,
  };
}
