"use client";

import { useEffect, useState } from "react";

export const ONBOARDING_OFFER_CLAIMED_EVENT = "segna:onboarding-offer-claimed";

export type OnboardingOfferClaimedDetail = {
  creditsAdded?: number;
};

export function dispatchOnboardingOfferClaimed(detail?: OnboardingOfferClaimedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ONBOARDING_OFFER_CLAIMED_EVENT, { detail }));
}

export function subscribeOnboardingOfferClaimed(
  handler: (detail: OnboardingOfferClaimedDetail | undefined) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<OnboardingOfferClaimedDetail>).detail;
    handler(detail);
  };
  window.addEventListener(ONBOARDING_OFFER_CLAIMED_EVENT, listener);
  return () => window.removeEventListener(ONBOARDING_OFFER_CLAIMED_EVENT, listener);
}

/** Masque immédiatement l’offre onboarding côté client (en attendant `router.refresh()`). */
export function useOnboardingOfferActive(initialActive: boolean): boolean {
  const [active, setActive] = useState(initialActive);

  useEffect(() => {
    setActive(initialActive);
  }, [initialActive]);

  useEffect(
    () =>
      subscribeOnboardingOfferClaimed(() => {
        setActive(false);
      }),
    [],
  );

  return active;
}
