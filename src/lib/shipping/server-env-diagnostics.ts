/**
 * Diagnostic des variables d’environnement côté serveur (noms + présence, jamais les valeurs).
 * Utilisé par les routes API quand une intégration transport n’est pas configurée.
 */

export type EnvVarProbe = {
  key: string;
  present: boolean;
  length: number;
};

export type EnvGroupDiagnostic = {
  configured: boolean;
  required: string[];
  missing: string[];
  present: string[];
  optional_present: string[];
  probes: EnvVarProbe[];
};

export type ShippingEnvDiagnostics = {
  deployment: {
    vercel_env: string | null;
    vercel_url: string | null;
    node_env: string | null;
    vercel_git_commit_ref: string | null;
  };
  mondial_relay_soap: EnvGroupDiagnostic;
  mondial_relay_connect: EnvGroupDiagnostic;
  mondial_relay_hub: EnvGroupDiagnostic;
  uber_direct: EnvGroupDiagnostic;
  coursier: EnvGroupDiagnostic;
};

function probe(key: string): EnvVarProbe {
  const value = process.env[key]?.trim() ?? "";
  return { key, present: value.length > 0, length: value.length };
}

function diagnoseGroup(required: string[], optional: string[] = []): EnvGroupDiagnostic {
  const requiredProbes = required.map(probe);
  const optionalProbes = optional.map(probe);
  const missing = requiredProbes.filter((p) => !p.present).map((p) => p.key);
  const present = requiredProbes.filter((p) => p.present).map((p) => p.key);
  const optional_present = optionalProbes.filter((p) => p.present).map((p) => p.key);
  return {
    configured: missing.length === 0,
    required,
    missing,
    present,
    optional_present,
    probes: [...requiredProbes, ...optionalProbes],
  };
}

const MR_SOAP_REQUIRED = ["MONDR_RELAY_SOAP_ENSEIGNE", "MONDR_RELAY_SOAP_PRIVATE_KEY"] as const;
const MR_SOAP_OPTIONAL = [
  "MONDR_RELAY_SOAP_URL",
  "MONDR_RELAY_SOAP_PLAN_TRI_URL",
  "MONDR_RELAY_SOAP_ACTION",
] as const;

const MR_CONNECT_REQUIRED = [
  "MONDR_CONNECT_API_BASE_URL",
  "MONDR_CONNECT_BRAND_ID",
  "MONDR_CONNECT_API_LOGIN",
  "MONDR_CONNECT_API_PASSWORD",
] as const;
const MR_CONNECT_OPTIONAL = ["MONDR_CONNECT_SHIPMENT_PATH"] as const;

const MR_HUB_REQUIRED = [
  "MONDR_SEGNA_RECIP_FIRSTNAME",
  "MONDR_SEGNA_RECIP_LASTNAME",
  "MONDR_SEGNA_RECIP_STREET",
  "MONDR_SEGNA_RECIP_HOUSENO",
  "MONDR_SEGNA_RECIP_COUNTRY",
  "MONDR_SEGNA_RECIP_POSTCODE",
  "MONDR_SEGNA_RECIP_CITY",
  "MONDR_SEGNA_RECIP_MOBILE",
  "MONDR_SEGNA_RECIP_EMAIL",
] as const;
const MR_HUB_OPTIONAL = ["MONDR_SEGNA_RECIP_TITLE", "MONDR_SEGNA_RETURN_DELIVERY_RELAY_CODE"] as const;

const UBER_REQUIRED = [
  "UBER_DIRECT_CLIENT_ID",
  "UBER_DIRECT_CLIENT_SECRET",
  "UBER_DIRECT_CUSTOMER_ID",
  "UBER_DIRECT_PICKUP_NAME",
  "UBER_DIRECT_PICKUP_PHONE",
  "UBER_DIRECT_PICKUP_LAT",
  "UBER_DIRECT_PICKUP_LON",
  "UBER_DIRECT_PICKUP_ADDRESS_JSON",
] as const;
const UBER_OPTIONAL = ["UBER_DIRECT_ENABLE_TEST_ROBO", "UBER_DIRECT_DROPOFF_PHONE_FALLBACK"] as const;

const COURSIER_REQUIRED = [
  "COURSIER_USER",
  "COURSIER_APIKEY",
  "COURSIER_CLIENT_ID",
  "COURSIER_PICKUP_ADDRESS",
  "COURSIER_PICKUP_POSTAL_CODE",
  "COURSIER_PICKUP_CITY",
  "COURSIER_PICKUP_COMPANY",
  "COURSIER_PICKUP_CONTACT",
  "COURSIER_PICKUP_PHONE",
] as const;
const COURSIER_OPTIONAL = [
  "COURSIER_PICKUP_COUNTRY",
  "COURSIER_PICKUP_EMAIL",
  "COURSIER_DROPOFF_PHONE_FALLBACK",
  "COURSIER_LANG",
] as const;

export function getShippingEnvDiagnostics(): ShippingEnvDiagnostics {
  return {
    deployment: {
      vercel_env: process.env.VERCEL_ENV?.trim() ?? null,
      vercel_url: process.env.VERCEL_URL?.trim() ?? null,
      node_env: process.env.NODE_ENV ?? null,
      vercel_git_commit_ref: process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? null,
    },
    mondial_relay_soap: diagnoseGroup([...MR_SOAP_REQUIRED], [...MR_SOAP_OPTIONAL]),
    mondial_relay_connect: diagnoseGroup([...MR_CONNECT_REQUIRED], [...MR_CONNECT_OPTIONAL]),
    mondial_relay_hub: diagnoseGroup([...MR_HUB_REQUIRED], [...MR_HUB_OPTIONAL]),
    uber_direct: diagnoseGroup([...UBER_REQUIRED], [...UBER_OPTIONAL]),
    coursier: diagnoseGroup([...COURSIER_REQUIRED], [...COURSIER_OPTIONAL]),
  };
}

/** Message lisible listant les clés manquantes pour un groupe. */
export function formatMissingEnvMessage(groupLabel: string, missing: string[]): string {
  if (missing.length === 0) return `${groupLabel} : configuration complète.`;
  return `${groupLabel} : variable(s) manquante(s) ou vide(s) côté serveur : ${missing.join(", ")}.`;
}
