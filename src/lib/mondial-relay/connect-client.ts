import type { MondialRelayConnectEnv } from "@/lib/mondial-relay/config";

/**
 * Évite le 404 « faux chemin » si `.env` reprend l’URL complète affichée chez MR
 * tout en gardant aussi `MONDR_CONNECT_SHIPMENT_PATH=/api/shipment` (double suffixe).
 */
export function resolveMondialRelayShipmentUrl(config: MondialRelayConnectEnv): string {
  const base = config.apiBaseUrl.replace(/\/$/, "");
  const path =
    config.shipmentPath === ""
      ? ""
      : config.shipmentPath.startsWith("/")
        ? config.shipmentPath
        : `/${config.shipmentPath}`;
  if (/\/api\/shipment$/i.test(base)) {
    return path === "" || path === "/api/shipment" ? base : `${base}${path}`;
  }
  return `${base}${path}`;
}

/**
 * POST JSON vers l’endpoint Shipment Connect. L’auth suit le schéma classique
 * login:mot de passe en HTTP Basic (valider dans le manuel développeur si besoin).
 *
 * Le corps doit être **exactement** celui décrit dans le manuel (sandbox).
 */
export async function postMondialRelayConnectShipment(
  config: MondialRelayConnectEnv,
  jsonBody: unknown,
): Promise<{ response: Response; text: string }> {
  const token = Buffer.from(`${config.apiLogin}:${config.apiPassword}`, "utf8").toString("base64");
  const response = await fetch(resolveMondialRelayShipmentUrl(config), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${token}`,
    },
    body: JSON.stringify(jsonBody),
    cache: "no-store",
  });

  const text = await response.text();
  return { response, text };
}
