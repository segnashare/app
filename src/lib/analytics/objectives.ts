/**
 * Objectif business porté par un événement PostHog.
 *
 * - `subscription` : abonnement SegnaX (objectif central)
 * - `purchase`     : achat / location d'une pièce du catalogue
 * - `app`          : téléchargement / ouverture de l'app iOS
 *
 * Les wrappers de tracking (website, mobile, serveur) ajoutent automatiquement
 * la propriété `objective` via `withAnalyticsObjective`. Un appel peut forcer la
 * valeur en passant `objective` explicitement dans les propriétés.
 */
export const ANALYTICS_OBJECTIVES = {
  subscription: "subscription",
  purchase: "purchase",
  app: "app",
} as const;

export type AnalyticsObjective =
  (typeof ANALYTICS_OBJECTIVES)[keyof typeof ANALYTICS_OBJECTIVES];

/** Événements dont l'objectif est fixe, quel que soit le contexte. */
const EVENT_OBJECTIVE: Readonly<Record<string, AnalyticsObjective>> = {
  subscription_interest: "subscription",
  subscription_checkout_started: "subscription",
  subscription_confirmed: "subscription",
  purchase_intent: "purchase",
  cart_item_added: "purchase",
  cart_checkout_started: "purchase",
  order_confirmed: "purchase",
  app_open_intent: "app",
};

function isObjective(value: unknown): value is AnalyticsObjective {
  return value === "subscription" || value === "purchase" || value === "app";
}

/** Déduit l'objectif d'un CTA à partir de sa destination (fallback si non explicite). */
function objectiveFromDestination(href: string, placement: string): AnalyticsObjective | undefined {
  const h = href.toLowerCase();
  if (h.includes("apps.apple.com") || h.includes("app.segnashare.com")) return "app";
  if (
    placement === "join_club" ||
    h.includes("abonnement") ||
    h.includes("/location") ||
    h.includes("/package")
  ) {
    return "subscription";
  }
  if (
    h.includes("catalogue") ||
    h.includes("panier") ||
    h.includes("/piece") ||
    h.includes("/shop") ||
    h.includes("/cart")
  ) {
    return "purchase";
  }
  return undefined;
}

export function resolveAnalyticsObjective(
  event: string,
  properties?: Record<string, unknown> | null,
): AnalyticsObjective | undefined {
  const explicit = properties?.objective;
  if (isObjective(explicit)) return explicit;

  const fixed = EVENT_OBJECTIVE[event];
  if (fixed) return fixed;

  // Paiement agrégé : l'objectif dépend de ce qui est payé.
  if (event === "payment_completed") {
    const family = properties?.product_family;
    if (family === "subscription" || family === "subscription_usage") return "subscription";
    if (family === "purchase" || family === "rental") return "purchase";
  }

  if (event === "cta_clicked") {
    const href = typeof properties?.cta_href === "string" ? properties.cta_href : "";
    const placement = typeof properties?.placement === "string" ? properties.placement : "";
    return objectiveFromDestination(href, placement);
  }
  return undefined;
}

/** Retourne les propriétés enrichies de `objective` quand il peut être déterminé. */
export function withAnalyticsObjective<T extends Record<string, unknown>>(
  event: string,
  properties: T,
): T & { objective?: AnalyticsObjective } {
  const objective = resolveAnalyticsObjective(event, properties);
  return objective ? { ...properties, objective } : properties;
}
