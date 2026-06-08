"use client";

import { CartCmsShopHubProvider } from "@/components/cart/CartCmsShopHubProvider";
import { CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS, CmsHorizontalScrollRow } from "@/components/cms/CmsSectionBlocks";
import { OnboardingIncludedCreditsProvider } from "@/components/onboarding/OnboardingIncludedCreditsProvider";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import type { WelcomeGiftLandingContent } from "@/lib/cms/welcome-gift-landing";
import { isWelcomeGiftOfferCmsFrame } from "@/lib/cms/welcome-gift-offer-visibility";
import { useOnboardingOfferActive } from "@/lib/onboarding/onboarding-offer-claimed-event";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

export type ExchangeDynamicCmsSectionProps = {
  sectionKey: string;
  cms: { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay };
  guideOfferOnboarding?: boolean;
  includedCreditsActivationContent?: WelcomeGiftLandingContent | null;
};

export function ExchangeDynamicCmsSection({
  sectionKey,
  cms,
  guideOfferOnboarding = false,
  includedCreditsActivationContent = null,
}: ExchangeDynamicCmsSectionProps) {
  const showOfferOnboarding = useOnboardingOfferActive(guideOfferOnboarding);
  const visibleFrames = showOfferOnboarding
    ? cms.frames
    : cms.frames.filter((row) => !isWelcomeGiftOfferCmsFrame(row));
  if (visibleFrames.length === 0) return null;

  return (
    <OnboardingIncludedCreditsProvider
      active={showOfferOnboarding}
      content={includedCreditsActivationContent}
    >
    <CartCmsShopHubProvider catalogItems={[]}>
      <section className="bg-white px-5 py-4">
        {!cms.display.hide_section_title ? (
          <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {cms.display.title?.trim() || sectionKey}
          </h2>
        ) : null}
        <CmsHorizontalScrollRow
          rows={visibleFrames}
          className={cn(cms.display.hide_section_title && "!mt-0")}
          hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
        />
      </section>
    </CartCmsShopHubProvider>
    </OnboardingIncludedCreditsProvider>
  );
}
