/**
 * Chiffrage livraison « échange » = envoi aller + retour (retour toujours en point relais).
 * Barèmes transporteur (€ HT) — simplification du poids par nombre d’articles.
 *
 * Tranches poids ↔ nombre de pièces :
 * - 1–3 articles → palier 0,5–1 kg
 * - 4–5 → 1–2 kg
 * - 6–7 → 2–3 kg
 * - 8–10 (max) → 3–4 kg
 *
 * Supplément : à partir du 4e article, +1,00 € par article sur la part **point relais**
 * (aller et retour en relais). Pour l’**aller domicile**, le supplément par article est
 * proportionnel au ratio (prix domicile / prix relais) du palier.
 */

export type ExchangeOutboundMode = "relay" | "home";

/** Bases point relais par palier (0,5–1 kg → 3–4 kg), en centimes. */
const RELAY_BASE_CENTS = [376, 527, 559, 559] as const;

/** Bases domicile pour les mêmes paliers, en centimes. */
const HOME_BASE_CENTS = [790, 913, 1362, 1362] as const;

const MAX_ITEMS = 10;

export function exchangeShippingTierIndex(itemCount: number): number {
  const n = Math.min(Math.max(Math.floor(itemCount), 1), MAX_ITEMS);
  if (n <= 3) return 0;
  if (n <= 5) return 1;
  if (n <= 7) return 2;
  return 3;
}

/** Un trajet en point relais (base palier + supplément articles > 3). */
export function relayLegTotalCents(itemCount: number): number {
  const n = Math.min(Math.max(Math.floor(itemCount), 1), MAX_ITEMS);
  const idx = exchangeShippingTierIndex(n);
  const base = RELAY_BASE_CENTS[idx];
  const extraArticles = Math.max(0, n - 3);
  return base + extraArticles * 100;
}

/** Un trajet à domicile (base palier + supplément ajusté vs relais). */
export function homeLegTotalCents(itemCount: number): number {
  const n = Math.min(Math.max(Math.floor(itemCount), 1), MAX_ITEMS);
  const idx = exchangeShippingTierIndex(n);
  const homeBase = HOME_BASE_CENTS[idx];
  const relayBase = RELAY_BASE_CENTS[idx];
  const extraArticles = Math.max(0, n - 3);
  if (extraArticles === 0) return homeBase;
  const perArticleRelayCents = 100;
  const ratio = homeBase / relayBase;
  const extraHomeCents = Math.round(perArticleRelayCents * ratio * extraArticles);
  return homeBase + extraHomeCents;
}

export type ExchangeRoundTripShipping = {
  /** Aller (mode choisi). */
  outboundCents: number;
  /** Retour, toujours tarif relais. */
  returnRelayCents: number;
  /** Aller + retour, sans option priorité Paris. */
  subtotalCents: number;
};

/**
 * @param itemCount — nombre de lignes panier (pièces)
 * @param outboundMode — `relay` : aller en relais ; `home` : aller à domicile
 */
export function computeExchangeRoundTripShippingCents(
  itemCount: number,
  outboundMode: ExchangeOutboundMode,
): ExchangeRoundTripShipping {
  const n = Math.min(Math.max(Math.floor(itemCount), 1), MAX_ITEMS);
  const returnRelayCents = relayLegTotalCents(n);
  const outboundCents =
    outboundMode === "relay" ? relayLegTotalCents(n) : homeLegTotalCents(n);
  return {
    outboundCents,
    returnRelayCents,
    subtotalCents: outboundCents + returnRelayCents,
  };
}

export function centsToEuros(cents: number): number {
  return Math.round(cents) / 100;
}
