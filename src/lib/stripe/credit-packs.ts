/** Packs « Obtenir plus » — alignés sur les prix Stripe (`STRIPE_PRICE_CREDITS_*`). */
export const CREDIT_PACK_AMOUNTS = [200, 500, 1000] as const;
export type CreditPackAmount = (typeof CREDIT_PACK_AMOUNTS)[number];

export function isCreditPackAmount(value: unknown): value is CreditPackAmount {
  return typeof value === "number" && Number.isInteger(value) && (CREDIT_PACK_AMOUNTS as readonly number[]).includes(value);
}

/**
 * Libellés écran `/package?plan=credits`.
 * Bandeau = crédits ; corps = prix unitaire (€ / crédit) puis prix TTC (`STRIPE_PRICE_CREDITS_*`).
 */
export const CREDIT_PACK_DISPLAY: Record<
  CreditPackAmount,
  {
    headerTitle: string;
    /** Prix TTC du pack en centimes d’euro (aligné Stripe / `priceLine`). */
    priceCentsTotal: number;
    priceLine: string;
    /** Sous le prix : accroche palier (souple / choisi / avantageux). */
    tagline: string;
    featured: boolean;
  }
> = {
  200: {
    headerTitle: "200 crédits",
    priceCentsTotal: 1799,
    priceLine: "17,99 €",
    tagline: "Le plus souple",
    featured: false,
  },
  500: {
    headerTitle: "500 crédits",
    priceCentsTotal: 3499,
    priceLine: "34,99 €",
    tagline: "Le plus choisi",
    featured: true,
  },
  1000: {
    headerTitle: "1000 crédits",
    priceCentsTotal: 4999,
    priceLine: "49,99 €",
    tagline: "Le plus avantageux",
    featured: false,
  },
};

const euroPerCreditFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Libellé carte pack : `0,09€/crédit` (prix TTC d’un crédit, virgule décimale). */
export function creditPackUnitEuroPerCreditLabel(amount: CreditPackAmount): string {
  const { priceCentsTotal } = CREDIT_PACK_DISPLAY[amount];
  const eurosPerCredit = priceCentsTotal / amount / 100;
  return `${euroPerCreditFormatter.format(eurosPerCredit)}€/crédit`;
}
