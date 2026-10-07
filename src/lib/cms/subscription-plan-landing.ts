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
  /** Libellé court du bouton d’achat (ex. « Profite de 3 mois pour 80 € »). Fourni par le CMS ou les défauts app. */
  syntheticCheckoutCta?: string;
  /** Pack prépayé 80 € / 3 mois (2 mois + 1 offert). Pas un essai Stripe. */
  billingTerm?: "monthly" | "3_month";
};

export function isThreeMonthPrepaidOffer(tier: SubscriptionOfferTier): boolean {
  if (tier.billingTerm === "3_month") return true;
  const blob = [tier.badge, tier.title, tier.subtitle, tier.syntheticCheckoutCta, tier.promoCard?.detailBold]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /engagement\s*3/.test(blob) || /\b3\s*mois\b/.test(blob);
}

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
    const billingTermRaw = str((o as Record<string, unknown>).billing_term);
    const looksThreeMonth = /engagement\s*3|\b3\s*mois\b/i.test(
      `${badge} ${title} ${subtitle} ${syntheticCheckoutCta}`,
    );
    const billingTerm: "3_month" | undefined =
      billingTermRaw === "3_month" || looksThreeMonth ? "3_month" : undefined;
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
      ...(billingTerm ? { billingTerm } : {}),
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
    syntheticCheckoutCta: "Profite de 3 mois pour 80 €",
    promoCard: {
      avgPriceDisplay: "~26,67€ / mois",
      detailBold: "1 mois offert",
      detailRest: ", 80 € payés d’un coup (2 mois + 1 offert).",
    },
    billingTerm: "3_month",
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
      body: "Accédez jusqu’à 400 € de pièces chaque mois, avec jusqu’à 6 pièces en location.",
    },
    {
      title: "Plus de liberté",
      body: "1 échange mensuel inclus, relais et domicile compris.",
    },
    {
      title: "Sans engagement",
      body: "49,99€ / mois, résiliable à tout moment.",
    },
  ],
  offerTiers: DEFAULT_TIERS,
  fallbackCheckoutPlanCode: "segna_x",
};

function mergeBillingTermFromDefaults(tiers: SubscriptionOfferTier[]): SubscriptionOfferTier[] {
  return tiers.map((tier, i) => {
    if (isThreeMonthPrepaidOffer(tier)) return { ...tier, billingTerm: "3_month" };
    const def = DEFAULT_TIERS[i];
    if (
      def?.billingTerm === "3_month" &&
      tier.badge === def.badge &&
      tier.title === def.title &&
      tier.checkoutPlanCode === def.checkoutPlanCode
    ) {
      return { ...tier, billingTerm: "3_month" };
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
    offerTiers = mergeBillingTermFromDefaults(offerTiers);
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
