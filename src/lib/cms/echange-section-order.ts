/**
 * Section CMS chargée uniquement dans le bloc « Panier actif » quand le panier est vide.
 * Exclue de `get_cms_echange_section_order` pour ne pas apparaître comme bloc séparé.
 */
export const EXCHANGE_CART_EMPTY_CMS_SECTION_KEY = "exchange_cart_empty";

/**
 * Section CMS intégrée au bloc « Prêts » quand aucun prêt n’est affiché.
 * Exclue de `get_cms_echange_section_order` (même logique que `exchange_cart_empty`).
 */
export const EXCHANGE_LENDS_EMPTY_CMS_SECTION_KEY = "exchange_lends_empty";

/** Clés reconnues pour l’ordre par défaut de la page Échange (`get_cms_echange_section_order`). */
export const DEFAULT_ECHANGE_SECTION_ORDER = [
  "commerce_promo_ad",
  "exchange_system_cart",
  "exchange_system_lends",
  "exchange_system_history",
] as const;

/**
 * Invité avec au moins un prêt : le rail CMS modulable dont le titre affiché est « Prêts »
 * (souvent ajouté au BO en complément de la promo) fait doublon avec « Prêts ».
 */
export function isExchangeGuestRedundantPretsModularSection(
  sectionKey: string,
  display: { title?: string | null; hide_section_title?: boolean | null },
): boolean {
  const title = (display.title ?? "").trim();
  const heading = title || sectionKey.trim();
  const normalized = heading
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (normalized === "prets") return true;
  const k = sectionKey.trim().toLowerCase();
  return k === "prets" || k === "guest_prets" || k === "echange_prets";
}

/**
 * Conserve l’ordre exact renvoyé par la RPC (y compris les sections CMS ajoutées au BO,
 * ex. « Nos offres »), déduplique, puis ajoute en queue toute clé par défaut absente.
 * Ne pas filtrer sur les seules clés `DEFAULT_*` : sinon les sections hors liste disparaissent côté app.
 */
export function mergeEchangeSectionOrder(fromRpc: string[] | null | undefined): string[] {
  if (!fromRpc?.length) return [...DEFAULT_ECHANGE_SECTION_ORDER];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of fromRpc) {
    if (typeof raw !== "string") continue;
    const k = raw.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    ordered.push(k);
  }
  for (const k of DEFAULT_ECHANGE_SECTION_ORDER) {
    if (!seen.has(k)) {
      seen.add(k);
      ordered.push(k);
    }
  }
  return ordered;
}

const EXCHANGE_SYSTEM_CART_KEY = "exchange_system_cart";
const EXCHANGE_SYSTEM_HISTORY_KEY = "exchange_system_history";

/**
 * Quand il y a des commandes confirmées « en cours », place le bloc Commandes
 * (`exchange_system_history`) juste au-dessus du panier (`exchange_system_cart`).
 */
export function prioritizeExchangeHistoryAboveCart(sectionOrder: string[], hasOngoingExchanges: boolean): string[] {
  if (!hasOngoingExchanges) return sectionOrder;
  const iCart = sectionOrder.indexOf(EXCHANGE_SYSTEM_CART_KEY);
  const iHist = sectionOrder.indexOf(EXCHANGE_SYSTEM_HISTORY_KEY);
  if (iCart === -1 || iHist === -1) return sectionOrder;
  if (iHist < iCart) return sectionOrder;
  const next = sectionOrder.filter((k) => k !== EXCHANGE_SYSTEM_HISTORY_KEY);
  const cartIdx = next.indexOf(EXCHANGE_SYSTEM_CART_KEY);
  if (cartIdx === -1) return sectionOrder;
  next.splice(cartIdx, 0, EXCHANGE_SYSTEM_HISTORY_KEY);
  return next;
}
