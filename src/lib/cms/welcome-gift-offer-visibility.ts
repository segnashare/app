import type { CmsFrameRow } from "@/lib/cms/cms-types";

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

/**
 * Carte CMS réservée à l’étape onboarding « offer » :
 * propriété explicite + lien package crédits.
 */
export function isOnboardingOfferCmsFrame(row: CmsFrameRow): boolean {
  const payload = row.payload ?? {};
  if (payload.onboarding_offer_only !== true) return false;
  return isPackageCreditsTargetUrl(payload.target_url);
}

/** @deprecated Alias historique — préférer `isOnboardingOfferCmsFrame`. */
export const isWelcomeGiftOfferCmsFrame = isOnboardingOfferCmsFrame;

/** Offre onboarding encore disponible (pas encore exercée via claim). */
export function canShowWelcomeGiftOffer(onboardingProcess: string | null | undefined): boolean {
  return onboardingProcess === "offer";
}

export function filterCartOfferFramesForWelcomeGiftEligibility(
  frames: CmsFrameRow[],
  onboardingProcess: string | null | undefined,
): CmsFrameRow[] {
  if (canShowWelcomeGiftOffer(onboardingProcess)) return frames;
  return frames.filter((row) => !isOnboardingOfferCmsFrame(row));
}
