import type { CmsFramePayload, CmsFrameRow } from "@/lib/cms/cms-types";

/** Lien interne vers la page crédits onboarding (`/package?plan=credits`). */
export function isPackageCreditsTargetUrl(raw: string | undefined | null): boolean {
  const url = raw?.trim() ?? "";
  if (!url) return false;
  try {
    const parsed = url.startsWith("http") ? new URL(url) : new URL(url, "https://segna.local");
    const path = parsed.pathname.replace(/\/$/, "") || "/";
    return path === "/package" && parsed.searchParams.get("plan")?.trim().toLowerCase() === "credits";
  } catch {
    const lower = url.toLowerCase();
    return lower.includes("/package") && lower.includes("plan=credits");
  }
}

function payloadLooksLikeWelcomeGiftOffer(payload: CmsFramePayload): boolean {
  if (payload.welcome_gift_credits_amount != null) return true;
  const chunks = [
    payload.title,
    payload.header,
    payload.label,
    payload.subtitle,
    payload.cta_label,
    payload.button_label,
    payload.welcome_gift_page_title,
    payload.welcome_gift_card_badge,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ")
    .toLowerCase();
  if (!chunks) return false;
  if (chunks.includes("cadeau de bienvenue")) return true;
  if (/\bobtenir\b/.test(chunks) && /\bcr[eé]dit/.test(chunks)) return true;
  if (chunks.includes("crédits offerts") || chunks.includes("credits offerts")) return true;
  return false;
}

/**
 * Carte CMS réservée à l’activation onboarding « offer » (à masquer une fois l’offre validée).
 */
export function isOnboardingOfferCmsFrame(row: CmsFrameRow): boolean {
  const payload = row.payload ?? {};
  if (payload.onboarding_offer_only === true) return true;
  if (row.frame_type === "welcome_gift_landing") return true;
  if (isPackageCreditsTargetUrl(payload.target_url)) return true;
  if (payloadLooksLikeWelcomeGiftOffer(payload)) return true;
  return false;
}

/** @deprecated Alias historique — préférer `isOnboardingOfferCmsFrame`. */
export const isWelcomeGiftOfferCmsFrame = isOnboardingOfferCmsFrame;

/** Étapes où la carte « crédits inclus » onboarding peut encore apparaître. */
const ONBOARDING_OFFER_VISIBLE_STEPS = new Set(["offer", "panier"]);

function normalizeOnboardingProcessStep(onboardingProcess: string | null | undefined): string {
  return (onboardingProcess ?? "").trim().toLowerCase();
}

/** Offre onboarding encore proposable (avant `exchange`, crédits inclus non activés). */
export function canShowWelcomeGiftOffer(
  onboardingProcess: string | null | undefined,
  includedCreditsClaimed = false,
): boolean {
  if (includedCreditsClaimed) return false;
  return ONBOARDING_OFFER_VISIBLE_STEPS.has(normalizeOnboardingProcessStep(onboardingProcess));
}

export function filterCartOfferFramesForWelcomeGiftEligibility(
  frames: CmsFrameRow[],
  onboardingProcess: string | null | undefined,
  includedCreditsClaimed = false,
): CmsFrameRow[] {
  if (canShowWelcomeGiftOffer(onboardingProcess, includedCreditsClaimed)) return frames;
  return frames.filter((row) => !isOnboardingOfferCmsFrame(row));
}
