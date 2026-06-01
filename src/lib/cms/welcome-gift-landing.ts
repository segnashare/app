import type { CmsFramePayload } from "@/lib/cms/cms-types";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { isOnboardingOfferCmsFrame } from "@/lib/cms/welcome-gift-offer-visibility";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

const CART_OFFERS_SECTION_KEY = "cart_offers";

/** Montant crédité par `/api/onboarding/offer/claim` si le CMS n’a pas de valeur. */
export const DEFAULT_WELCOME_GIFT_CREDITS_AMOUNT = 250;

export type WelcomeGiftLandingValueProp = { title: string; body: string };

export type WelcomeGiftLandingContent = {
  pageTitle: string;
  cardBadge: string;
  creditsAmount: number;
  cardSubtitle: string;
  introBody: string;
  ctaLabel: string;
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

const DEFAULTS: WelcomeGiftLandingContent = {
  pageTitle: "Ton cadeau de bienvenue",
  cardBadge: "Crédits offerts",
  creditsAmount: DEFAULT_WELCOME_GIFT_CREDITS_AMOUNT,
  cardSubtitle: "crédits offerts",
  introBody: "",
  ctaLabel: "Profiter des crédits gratuits",
  footnote: "",
  valueProps: [],
};

export function parseWelcomeGiftLandingPayload(payload: CmsFramePayload | null | undefined): WelcomeGiftLandingContent {
  const p = payload ?? {};
  const creditsAmount = parseCreditsAmount(p.welcome_gift_credits_amount) ?? DEFAULTS.creditsAmount;
  const valueProps = parseValueProps(p.welcome_gift_value_props);

  return {
    pageTitle: str(p.welcome_gift_page_title) || DEFAULTS.pageTitle,
    cardBadge: str(p.welcome_gift_card_badge) || DEFAULTS.cardBadge,
    creditsAmount,
    cardSubtitle: str(p.welcome_gift_card_subtitle) || DEFAULTS.cardSubtitle,
    introBody: str(p.welcome_gift_intro_body) || DEFAULTS.introBody,
    ctaLabel: str(p.welcome_gift_cta_label) || DEFAULTS.ctaLabel,
    footnote: str(p.welcome_gift_footnote) || DEFAULTS.footnote,
    valueProps: valueProps.length > 0 ? valueProps : DEFAULTS.valueProps,
  };
}

export async function fetchWelcomeGiftLandingContent(supabase: StorageSignClient): Promise<WelcomeGiftLandingContent> {
  const frames = await fetchCmsSectionFramesResolved(supabase, CART_OFFERS_SECTION_KEY);
  const offerFrame = frames.find(isOnboardingOfferCmsFrame);
  return parseWelcomeGiftLandingPayload(offerFrame?.payload);
}
