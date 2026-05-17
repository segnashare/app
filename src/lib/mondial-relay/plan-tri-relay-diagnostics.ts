import { getMondialRelayConnectEnv, type MondialRelaySoapEnv } from "@/lib/mondial-relay/config";
import type { RelaySearchHit } from "@/lib/mondial-relay/soap-point-relais-search";
import { mondialRelayLivRelSixDigits } from "@/lib/mondial-relay/soap-plan-tri-pretri";

const DEFAULT_WSI3_URL = "https://api.mondialrelay.com/Web_Services.asmx";
const DEFAULT_PLAN_TRI_URL = "https://api.mondialrelay.com/WSI_PlanTri.asmx";

function maskPostcode(cp: string): string {
  const t = cp.replace(/\s/g, "").trim();
  if (t.length <= 2) return "**";
  return `${t.slice(0, 2)}…${t.slice(-2)}`;
}

export type PlanTriRelayDiagnostics = {
  /** MR ne renvoie pas quel segment du hash est faux. */
  mr_api_limitation: string;
  /** Si WSI3 a renvoyé des points, la paire enseigne + clé SOAP est valide pour la recherche. */
  inference_when_wsi3_succeeded: string;
  /** Ordre de concaténation attendu pour ObtenirPreTri (cf. doc MR « Generating the security key »). */
  obtenir_pretri_concat_order: string;
  obtenir_pretri_inputs: {
    modeLiv: string;
    hub_dest_country: string;
    hub_dest_postcode_masked: string;
  };
  /**
   * `LIV_Rel_Pays` et `LIV_Rel` ne sont pas des variables d’environnement : une requête ObtenirPreTri
   * par point, avec les valeurs dérivées du premier résultat WSI3 (exemple ci-dessous).
   */
  pretri_sample_first_wsi3_relay: {
    relay_location_code: string;
    liv_rel_pays_sent: string;
    liv_rel_six_digits_sent: string;
  } | null;
  checks: {
    /** `null` si Connect n’est pas configuré sur ce serveur. */
    soap_enseigne_matches_connect_brand_id: boolean | null;
    soap_private_key_had_leading_or_trailing_whitespace: boolean;
    soap_enseigne_had_leading_or_trailing_whitespace: boolean;
    soap_private_key_trimmed_char_count: number;
    soap_enseigne_trimmed_char_count: number;
    /** Toujours `true` si WSI3 a réussi ; sinon les compteurs ci-dessus seraient incohérents. */
    soap_enseigne_and_private_key_non_empty: boolean;
    wsi3_and_plan_tri_same_hostname: boolean;
    wsi3_url_differs_from_code_default: boolean;
    plan_tri_url_differs_from_code_default: boolean;
  };
  /** Actions les plus probables en fonction des checks (sans deviner la clé). */
  suggested_next_steps: string[];
};

/**
 * Diagnostics sûrs (aucun secret) quand tous les relais sont exclus avec le statut MR 97
 * alors que WSI3 a déjà renvoyé des points : affine la cause sans contredire la doc MR.
 */
export function buildPlanTriRelayDiagnosticsWhenAllStat97(input: {
  soap: MondialRelaySoapEnv;
  modeLiv: string;
  hubDestPostcode: string;
  hubDestCountry: string;
  wsi3ReturnedHits: boolean;
  excludedStatHistogram: Record<string, number> | undefined;
  excludedCount: number;
  /** Premier point WSI3 : illustre les segments LIV_* du hash ObtenirPreTri. */
  firstWsi3RelayHit: RelaySearchHit | null | undefined;
}): PlanTriRelayDiagnostics | null {
  if (!input.wsi3ReturnedHits || input.excludedCount < 1) return null;

  const hist = input.excludedStatHistogram ?? {};
  const total = Object.values(hist).reduce((a, b) => a + b, 0);
  const n97 = hist["97"] ?? 0;
  if (total === 0 || n97 !== total) return null;

  const rawKey = process.env.MONDR_RELAY_SOAP_PRIVATE_KEY ?? "";
  const rawEns = process.env.MONDR_RELAY_SOAP_ENSEIGNE ?? "";
  const connect = getMondialRelayConnectEnv();

  let wsi3Host = "";
  let planHost = "";
  try {
    wsi3Host = new URL(input.soap.endpoint).hostname;
    planHost = new URL(input.soap.planTriEndpoint).hostname;
  } catch {
    return null;
  }

  const brandMatch =
    connect == null ? null : connect.brandId.trim().toUpperCase() === input.soap.enseigne.trim().toUpperCase();

  const suggested: string[] = [
    "Vérifier sur l’extranet MR que la clé copiée dans MONDR_RELAY_SOAP_PRIVATE_KEY est bien celle du bloc **API 1 (SOAP / WebService.asmx)**, pas le mot de passe du bloc **API 2 (Connect)**.",
  ];

  if (brandMatch === false) {
    suggested.unshift(
      "Aligner MONDR_RELAY_SOAP_ENSEIGNE sur MONDR_CONNECT_BRAND_ID (même valeur que l’identification de marque Connect) — incohérence détectée.",
    );
  }
  if (rawKey !== rawKey.trim() || rawEns !== rawEns.trim()) {
    suggested.push(
      "Retirer les espaces ou guillemets parasites autour de MONDR_RELAY_SOAP_PRIVATE_KEY ou MONDR_RELAY_SOAP_ENSEIGNE dans le fichier d’environnement (Vercel / .env).",
    );
  }
  if (wsi3Host !== planHost) {
    suggested.push(
      `Les hôtes SOAP diffèrent (WSI3=${wsi3Host} vs PlanTri=${planHost}) : utiliser la même base API que celle fournie par MR pour ce compte.`,
    );
  }
  suggested.push(
    "Confirmer avec MR ou la doc produit que le ModeLiv utilisé pour ObtenirPreTri est bien celui du contrat (souvent identique au champ Action WSI3 pour le même flux).",
  );

  const hit = input.firstWsi3RelayHit ?? null;
  const livRelPays = hit ? (hit.country || "FR").trim().toUpperCase() : "";
  const livRel = hit ? mondialRelayLivRelSixDigits(hit.numRaw, hit.code) : "";
  const pretri_sample_first_wsi3_relay =
    hit && livRel
      ? {
          relay_location_code: hit.code,
          liv_rel_pays_sent: livRelPays || "FR",
          liv_rel_six_digits_sent: livRel,
        }
      : hit
        ? {
            relay_location_code: hit.code,
            liv_rel_pays_sent: livRelPays || "FR",
            liv_rel_six_digits_sent: "(vide — numéro relais introuvable pour ce point)",
          }
        : null;

  return {
    mr_api_limitation:
      "Mondial Relay renvoie uniquement le statut 97 (« clé de sécurité invalide ») : il n’indique pas si l’erreur vient de la clé privée, de l’enseigne, du ModeLiv, du hub (Dest_CP / Dest_Pays) ou des segments par relais LIV_Rel_Pays + LIV_Rel (issus de chaque point WSI3, pas du .env).",
    inference_when_wsi3_succeeded:
      "WSI3_PointRelais_Recherche a accepté la même enseigne et la même clé privée SOAP : le rejet 100 % sur ObtenirPreTri pointe en principe vers la construction du hash spécifique à ObtenirPreTri (champs ou ordre), vers un ModeLiv / hub incompatible avec le contrat, ou vers un endpoint PlanTri qui ne correspond pas à l’environnement du compte.",
    obtenir_pretri_concat_order:
      "Chaîne typique avant MD5 : Enseigne + ModeLiv + Dest_CP + Dest_Pays + LIV_Rel_Pays + LIV_Rel + clé privée (puis MD5, 32 caractères hex en majuscules).",
    obtenir_pretri_inputs: {
      modeLiv: input.modeLiv.trim().toUpperCase(),
      hub_dest_country: input.hubDestCountry.trim().toUpperCase() || "FR",
      hub_dest_postcode_masked: maskPostcode(input.hubDestPostcode),
    },
    pretri_sample_first_wsi3_relay,
    checks: {
      soap_enseigne_matches_connect_brand_id: brandMatch,
      soap_private_key_had_leading_or_trailing_whitespace: rawKey !== rawKey.trim(),
      soap_enseigne_had_leading_or_trailing_whitespace: rawEns !== rawEns.trim(),
      soap_private_key_trimmed_char_count: input.soap.privateKey.length,
      soap_enseigne_trimmed_char_count: input.soap.enseigne.length,
      soap_enseigne_and_private_key_non_empty:
        input.soap.enseigne.length > 0 && input.soap.privateKey.length > 0,
      wsi3_and_plan_tri_same_hostname: wsi3Host === planHost,
      wsi3_url_differs_from_code_default: input.soap.endpoint.trim() !== DEFAULT_WSI3_URL,
      plan_tri_url_differs_from_code_default: input.soap.planTriEndpoint.trim() !== DEFAULT_PLAN_TRI_URL,
    },
    suggested_next_steps: suggested,
  };
}
