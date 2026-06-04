import type { CmsFramePayload } from "@/lib/cms/cms-types";

export type SubscriptionPlanLandingValueProp = { title: string; body: string };

/** Mise en avant carte engagement : prix moyen en gros, puis détail (ex. mois offert en gras + reste). */
export type SubscriptionOfferTierPromoCard = {
  avgPriceDisplay: string;
  /** Conservé pour compatibilité payload CMS ; non affiché (pas de mention de % en UI). */
  discountVsFullPct?: number;
  detailBold: string;
  detailRest: string;
};

export type SubscriptionOfferTier = {
  badge: string;
  title: string;
  subtitle: string;
  priceLine: string;
  microLine: string;
  featured: boolean;
  checkoutPlanCode: "segna_x" | "segna_plus";
  /** Si défini : corps de carte « promo » (prix moyen gros, puis détail gris). Sinon affichage classique title / subtitle / price / micro. */
  promoCard?: SubscriptionOfferTierPromoCard;
  /** Libellé court du bouton d’achat (ex. « Profite de 3 mois pour 99,99 € »). Fourni par le CMS ou les défauts app. */
  syntheticCheckoutCta?: string;
  /**
   * Période d’essai Stripe (jours) pour ce palier — ex. 30 pour « 1 mois offert » sur SegnaX.
   * Envoyé au checkout ; ignoré si absent.
   */
  trialPeriodDays?: number;
};

export type SubscriptionPlanLandingContent = {
  /** Conservé pour le payload CMS ; non affiché sur l’écran membre (titre = `pageTitle`). */
  headerWordmark: string;
  /** Champs hero optionnels (CMS) ; non utilisés sur l’UI actuelle. */
  heroTitle: string;
  heroImageUrl: string | null;
  /** Titre sous la croix (écran type checkout). */
  pageTitle: string;
  creditsLine: string;
  introBody: string;
  ctaLabel: string;
  footnote: string;
  valueProps: SubscriptionPlanLandingValueProp[];
  offerTiers: SubscriptionOfferTier[];
  /** Repli si un palier n’a pas de `checkout_plan_code` propre. */
  fallbackCheckoutPlanCode: "segna_x" | "segna_plus";
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseValueProps(raw: unknown): SubscriptionPlanLandingValueProp[] {
  if (!Array.isArray(raw)) return [];
  const out: SubscriptionPlanLandingValueProp[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const title = str(o.title);
    const body = str(o.body);
    if (!title && !body) continue;
    out.push({ title, body });
  }
  return out;
}

function parseCheckout(v: unknown): "segna_x" | "segna_plus" {
  const s = str(v).toLowerCase();
  return s === "segna_plus" ? "segna_plus" : "segna_x";
}

function parseOfferTiers(raw: unknown, fallbackPlan: "segna_x" | "segna_plus"): SubscriptionOfferTier[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: SubscriptionOfferTier[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const badge = str(o.badge);
    const title = str(o.title);
    const subtitle = str(o.subtitle);
    const priceLine = str(o.price_line);
    const microLine = str(o.micro_line);
    if (!badge && !title && !subtitle && !priceLine && !microLine) continue;
    const featured = o.featured === true;
    const checkoutPlanCode = o.checkout_plan_code != null ? parseCheckout(o.checkout_plan_code) : fallbackPlan;
    const promoAvg = str((o as Record<string, unknown>).promo_avg_price);
    const promoPctRaw = (o as Record<string, unknown>).promo_discount_pct;
    let promoPct: number | null = null;
    if (typeof promoPctRaw === "number" && Number.isFinite(promoPctRaw)) {
      promoPct = Math.round(promoPctRaw);
    } else if (typeof promoPctRaw === "string" && promoPctRaw.trim()) {
      const n = Number.parseFloat(promoPctRaw.replace(",", "."));
      if (Number.isFinite(n)) promoPct = Math.round(n);
    }
    const promoBold = str((o as Record<string, unknown>).promo_detail_bold);
    const promoRest = str((o as Record<string, unknown>).promo_detail_rest);
    const syntheticCheckoutCta = str((o as Record<string, unknown>).synthetic_checkout_cta);
    const trialRaw = (o as Record<string, unknown>).trial_period_days;
    let trialPeriodDays: number | undefined;
    if (typeof trialRaw === "number" && Number.isFinite(trialRaw)) {
      const d = Math.floor(trialRaw);
      if (d >= 1 && d <= 45) trialPeriodDays = d;
    } else if (typeof trialRaw === "string" && trialRaw.trim()) {
      const n = Number.parseInt(trialRaw.trim(), 10);
      if (Number.isFinite(n)) {
        const d = Math.floor(n);
        if (d >= 1 && d <= 45) trialPeriodDays = d;
      }
    }
    const promoCard =
      promoAvg && promoBold
        ? ({
            avgPriceDisplay: promoAvg,
            ...(promoPct != null ? { discountVsFullPct: promoPct } : {}),
            detailBold: promoBold,
            detailRest: promoRest,
          } satisfies SubscriptionOfferTierPromoCard)
        : undefined;
    out.push({
      badge,
      title,
      subtitle,
      priceLine,
      microLine,
      featured,
      checkoutPlanCode,
      ...(promoCard ? { promoCard } : {}),
      ...(syntheticCheckoutCta ? { syntheticCheckoutCta } : {}),
      ...(trialPeriodDays != null ? { trialPeriodDays } : {}),
    });
  }
  return out;
}

function heroImageUrlFromPayload(p: CmsFramePayload): string | null {
  const img = p.subscription_hero_image;
  if (!img || typeof img !== "object") return null;
  const signed = (img as { signed_url?: unknown }).signed_url;
  if (typeof signed === "string" && signed.trim()) return signed.trim();
  return null;
}

const DEFAULT_TIERS: SubscriptionOfferTier[] = [
  {
    badge: "Nouveau",
    title: "49,99€ / mois",
    subtitle: "Sans engagement.",
    priceLine: "",
    microLine: "",
    featured: false,
    checkoutPlanCode: "segna_x",
    syntheticCheckoutCta: "SegnaX pour 49,99 € / mois",
  },
  {
    badge: "Engagement 3 mois",
    title: "3 mois SegnaX",
    subtitle: "",
    priceLine: "",
    microLine: "",
    featured: false,
    checkoutPlanCode: "segna_x",
    syntheticCheckoutCta: "Profite de 3 mois pour 99,99 €",
    promoCard: {
      avgPriceDisplay: "~33,33€ / mois",
      detailBold: "1 mois offert",
      detailRest: ", puis 2 mois à 49,99 € / mois.",
    },
    trialPeriodDays: 30,
  },
];

const DEFAULTS: Omit<SubscriptionPlanLandingContent, "offerTiers" | "heroImageUrl" | "fallbackCheckoutPlanCode"> & {
  offerTiers: SubscriptionOfferTier[];
  heroImageUrl: null;
  fallbackCheckoutPlanCode: "segna_x";
} = {
  headerWordmark: "SegnaX",
  heroTitle: "",
  heroImageUrl: null,
  pageTitle: "Devenez membre SegnaX",
  creditsLine: "",
  introBody: "",
  ctaLabel: "Passer à l’abonnement",
  footnote:
    "* La capacité d’emprunt dépend des conditions du plan. Paiement à la confirmation ; renouvellement automatique sauf annulation avant l’échéance.",
  valueProps: [
    {
      title: "Plus de pièces",
      body: "Tu as 2 échanges inclus par mois, avec jusqu’à 5 pièces par échange.",
    },
    {
      title: "Plus de style",
      body: "Tu reçois 500 crédits bonus à utiliser sur les pièces qui te plaisent le plus.",
    },
    {
      title: "Plus de liberté",
      body: "Tu es couverte par l’assurance Segna sur les échanges, selon nos conditions.",
    },
  ],
  offerTiers: DEFAULT_TIERS,
  fallbackCheckoutPlanCode: "segna_x",
};

/** Paliers CMS sans `trial_period_days` : complète depuis les défauts si badge/titre/code identiques. */
function mergeTrialPeriodDaysFromDefaults(tiers: SubscriptionOfferTier[]): SubscriptionOfferTier[] {
  return tiers.map((tier, i) => {
    const def = DEFAULT_TIERS[i];
    if (!def || tier.trialPeriodDays != null || def.trialPeriodDays == null) return tier;
    if (tier.badge === def.badge && tier.title === def.title && tier.checkoutPlanCode === def.checkoutPlanCode) {
      return { ...tier, trialPeriodDays: def.trialPeriodDays };
    }
    return tier;
  });
}

export function parseSubscriptionPlanLandingPayload(payload: CmsFramePayload | null | undefined): SubscriptionPlanLandingContent {
  const p = payload ?? {};
  const fallbackCheckoutPlanCode = parseCheckout(p.subscription_checkout_plan_code);
  const tiersParsed = parseOfferTiers(p.subscription_offer_tiers, fallbackCheckoutPlanCode);
  let offerTiers: SubscriptionOfferTier[];
  if (tiersParsed.length === 0) {
    offerTiers = [...DEFAULT_TIERS];
  } else {
    offerTiers = [...tiersParsed];
    for (let i = 0; i < DEFAULT_TIERS.length; i++) {
      if (offerTiers[i] === undefined) {
        offerTiers[i] = DEFAULT_TIERS[i]!;
      }
    }
    offerTiers = mergeTrialPeriodDaysFromDefaults(offerTiers);
  }
  const valueProps = parseValueProps(p.subscription_value_props);
  const heroImageUrl = heroImageUrlFromPayload(p);

  return {
    headerWordmark: str(p.subscription_header_wordmark) || DEFAULTS.headerWordmark,
    heroTitle: str(p.subscription_hero_title) || DEFAULTS.heroTitle,
    heroImageUrl,
    pageTitle: str(p.subscription_page_title) || DEFAULTS.pageTitle,
    creditsLine: str(p.subscription_credits_line) || DEFAULTS.creditsLine,
    introBody: str(p.subscription_intro_body) || DEFAULTS.introBody,
    ctaLabel: str(p.subscription_cta_label) || DEFAULTS.ctaLabel,
    footnote: str(p.subscription_footnote) || DEFAULTS.footnote,
    valueProps: valueProps.length > 0 ? valueProps : DEFAULTS.valueProps,
    offerTiers,
    fallbackCheckoutPlanCode,
  };
}
