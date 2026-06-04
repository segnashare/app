import type { CmsFramePayload } from "@/lib/cms/cms-types";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { isOnboardingOfferCmsFrame } from "@/lib/cms/welcome-gift-offer-visibility";
import {
  fetchPlanEntitlementComparisonLimits,
  PLAN_ENTITLEMENT_COMPARISON_FALLBACK,
} from "@/lib/billing/fetch-plan-entitlement-comparison-limits";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

const CART_OFFERS_SECTION_KEY = "cart_offers";

/** Secours si la table BO est inaccessible. */
export const DEFAULT_INCLUDED_CREDITS_AMOUNT =
  PLAN_ENTITLEMENT_COMPARISON_FALLBACK.guestMonthlyCredits;

export type WelcomeGiftLandingValueProp = { title: string; body: string };

export type WelcomeGiftLandingContent = {
  pageTitle: string;
  cardBadge: string;
  /** Montant affiché + crédité une fois à l’activation onboarding (BO `guest.monthly_consumption_points_grant`). */
  creditsAmount: number;
  cardSubtitle: string;
  cardCtaLabel: string;
  introBody: string;
  activateCtaLabel: string;
  footnote: string;
  valueProps: WelcomeGiftLandingValueProp[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseCreditsAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    if (n >= 1 && n <= 9999) return n;
    return null;
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 9999) return n;
  }
  return null;
}

function parseValueProps(raw: unknown): WelcomeGiftLandingValueProp[] {
  if (!Array.isArray(raw)) return [];
  const out: WelcomeGiftLandingValueProp[] = [];
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

/** Valeur panier affichée (1 crédit ≈ 1 € de réservation). */
export function formatIncludedCreditsBasketValueEuros(creditsAmount: number): string {
  const n = Math.max(1, Math.trunc(creditsAmount));
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function buildDefaults(creditsAmount: number): WelcomeGiftLandingContent {
  const n = Math.max(1, creditsAmount);
  const basketValue = formatIncludedCreditsBasketValueEuros(n);
  return {
    pageTitle: "Active tes crédits offerts",
    cardBadge: "Crédits offerts",
    creditsAmount: n,
    cardSubtitle: "crédits offerts",
    cardCtaLabel: `Activer mes ${n} crédits`,
    introBody: [
      `${n} crédits offerts pour composer tes paniers :`,
      `• Permet de réserver des paniers jusqu’à ${basketValue} de pièces`,
      "• Active ta réserve pour lancer ton premier échange",
      "• Tu veux plus de crédits ? Prête des pièces à la collection",
    ].join("\n"),
    activateCtaLabel: `Activer mes ${n} crédits`,
    footnote: "",
    valueProps: [],
  };
}

export function parseWelcomeGiftLandingPayload(
  payload: CmsFramePayload | null | undefined,
  includedCreditsFromBoard: number,
): WelcomeGiftLandingContent {
  const defaults = buildDefaults(includedCreditsFromBoard);
  const p = payload ?? {};
  const cmsOverride = parseCreditsAmount(p.welcome_gift_credits_amount);
  const creditsAmount = cmsOverride ?? defaults.creditsAmount;
  const valueProps = parseValueProps(p.welcome_gift_value_props);

  return {
    pageTitle: str(p.welcome_gift_page_title) || defaults.pageTitle,
    cardBadge: str(p.welcome_gift_card_badge) || defaults.cardBadge,
    creditsAmount,
    cardSubtitle: str(p.welcome_gift_card_subtitle) || defaults.cardSubtitle,
    cardCtaLabel:
      str(p.welcome_gift_cta_label) || str(p.welcome_gift_card_cta_label) || defaults.cardCtaLabel,
    introBody: str(p.welcome_gift_intro_body) || defaults.introBody,
    activateCtaLabel: str(p.welcome_gift_activate_cta_label) || defaults.activateCtaLabel,
    footnote: str(p.welcome_gift_footnote) || defaults.footnote,
    valueProps,
  };
}

export async function fetchWelcomeGiftLandingContent(supabase: StorageSignClient): Promise<WelcomeGiftLandingContent> {
  const [frames, limits] = await Promise.all([
    fetchCmsSectionFramesResolved(supabase, CART_OFFERS_SECTION_KEY),
    fetchPlanEntitlementComparisonLimits(),
  ]);
  const offerFrame = frames.find(isOnboardingOfferCmsFrame);
  const boardAmount = Math.max(1, Math.floor(limits.guestMonthlyCredits));
  return parseWelcomeGiftLandingPayload(offerFrame?.payload, boardAmount);
}

/** Libellé pastille carte hub (panier / échange). */
export function formatIncludedCreditsHubCtaLabel(content: WelcomeGiftLandingContent): string {
  return content.cardCtaLabel.trim() || `Activer mes ${content.creditsAmount} crédits`;
}
