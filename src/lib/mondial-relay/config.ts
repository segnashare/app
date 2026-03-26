export type MondialRelayConnectEnv = {
  apiBaseUrl: string;
  brandId: string;
  apiLogin: string;
  apiPassword: string;
  /** Chemin sous `apiBaseUrl`, ex. `/api/shipment` */
  shipmentPath: string;
};

/**
 * L’intégration MR reste désactivée tant que ces variables ne sont pas toutes renseignées.
 * Coller les identifiants **TEST** depuis Connect > Configuration API dans `.env.local`.
 */
export function getMondialRelayConnectEnv(): MondialRelayConnectEnv | null {
  const apiBaseUrl = process.env.MONDR_CONNECT_API_BASE_URL?.trim();
  const brandId = process.env.MONDR_CONNECT_BRAND_ID?.trim();
  const apiLogin = process.env.MONDR_CONNECT_API_LOGIN?.trim();
  const apiPassword = process.env.MONDR_CONNECT_API_PASSWORD?.trim();
  const shipmentPath = process.env.MONDR_CONNECT_SHIPMENT_PATH?.trim() || "/api/shipment";

  if (!apiBaseUrl || !brandId || !apiLogin || !apiPassword) {
    return null;
  }

  return {
    apiBaseUrl,
    brandId,
    apiLogin,
    apiPassword,
    shipmentPath: shipmentPath.startsWith("/") ? shipmentPath : `/${shipmentPath}`,
  };
}

/** API 1 (SOAP) — recherche de points relais `WSI3_PointRelais_Recherche`, distinct de Connect (API 2). */
export type MondialRelaySoapEnv = {
  /** URL complète du endpoint .asmx (ex. https://api.mondialrelay.com/Web_Services.asmx) */
  endpoint: string;
  /** `WSI_PlanTri.asmx` — filtre « plan de tri » (ObtenirPreTri), même base que la doc MR */
  planTriEndpoint: string;
  /** Code enseigne (même zone « API 1 » que sur l’extranet MR) */
  enseigne: string;
  privateKey: string;
  /** Valeur du champ `Action` SOAP ; souvent alignée sur le produit relais (24R, …) — voir contrat MR */
  defaultAction: string;
};

export function getMondialRelaySoapEnv(): MondialRelaySoapEnv | null {
  const enseigne = process.env.MONDR_RELAY_SOAP_ENSEIGNE?.trim();
  const privateKey = process.env.MONDR_RELAY_SOAP_PRIVATE_KEY?.trim();
  if (!enseigne || !privateKey) {
    return null;
  }
  const endpoint =
    process.env.MONDR_RELAY_SOAP_URL?.trim() || "https://api.mondialrelay.com/Web_Services.asmx";
  const planTriEndpoint =
    process.env.MONDR_RELAY_SOAP_PLAN_TRI_URL?.trim() || "https://api.mondialrelay.com/WSI_PlanTri.asmx";
  const defaultAction = process.env.MONDR_RELAY_SOAP_ACTION?.trim() || "24R";
  return { endpoint, planTriEndpoint, enseigne, privateKey, defaultAction };
}
