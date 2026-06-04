"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { IncludedCreditsSummaryText } from "@/components/onboarding/IncludedCreditsSummaryText";
import {
  SegnaDialogDismissButton,
  SEGNA_DIALOG_SHEET_CLASS,
  segnaDialogTitleClass,
} from "@/components/ui/SegnaAppDialog";
import type { WelcomeGiftLandingContent } from "@/lib/cms/welcome-gift-landing";
import { isPackageCreditsTargetUrl } from "@/lib/cms/welcome-gift-offer-visibility";
import type { CmsFramePayload } from "@/lib/cms/cms-types";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

type ContextValue = {
  active: boolean;
  content: WelcomeGiftLandingContent | null;
  openActivationSheet: () => void;
  shouldInterceptOfferNavigation: (payload: CmsFramePayload) => boolean;
};

const OnboardingIncludedCreditsContext = createContext<ContextValue | null>(null);

export function OnboardingIncludedCreditsProvider({
  active,
  content,
  children,
}: {
  active: boolean;
  content: WelcomeGiftLandingContent | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const shouldInterceptOfferNavigation = useCallback(
    (payload: CmsFramePayload) => {
      if (!active || !content) return false;
      if (payload.onboarding_offer_only === true) return true;
      return isPackageCreditsTargetUrl(payload.target_url);
    },
    [active, content],
  );

  const handleActivate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const response = await fetch("/api/onboarding/offer/claim", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Impossible d’activer tes crédits inclus.");
      }
      setOpen(false);
      setLoading(false);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible d’activer tes crédits inclus.";
      window.alert(message);
      setLoading(false);
    }
  }, [loading, router]);

  const value = useMemo<ContextValue>(
    () => ({
      active,
      content,
      openActivationSheet: () => setOpen(true),
      shouldInterceptOfferNavigation,
    }),
    [active, content, shouldInterceptOfferNavigation],
  );

  return (
    <OnboardingIncludedCreditsContext.Provider value={value}>
      {children}
      {active && content && open ? (
        <div
          className="fixed inset-0 z-[80] flex flex-col justify-end bg-black/40"
          role="presentation"
          onClick={() => !loading && setOpen(false)}
        >
          <div className={SEGNA_DIALOG_SHEET_CLASS} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <h2 className={segnaDialogTitleClass()}>{content.pageTitle}</h2>
              <SegnaDialogDismissButton
                variant="inline"
                onClick={() => !loading && setOpen(false)}
                aria-label="Fermer"
              />
            </div>
            <p className={cn(segnaMontserrat.className, "mt-3 text-[28px] font-extrabold leading-none text-zinc-950")}>
              {content.creditsAmount}
              <span className="ml-2 text-[16px] font-bold text-zinc-600">{content.cardSubtitle}</span>
            </p>
            <IncludedCreditsSummaryText introBody={content.introBody} className="mt-4" />
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleActivate()}
              className={cn(
                segnaMontserrat.className,
                "mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-70",
              )}
            >
              {loading ? "Activation…" : content.activateCtaLabel}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setOpen(false)}
              className={cn(
                segnaMontserrat.className,
                "mt-3 flex h-10 w-full items-center justify-center text-[14px] font-semibold text-zinc-700 underline underline-offset-4",
              )}
            >
              Plus tard
            </button>
          </div>
        </div>
      ) : null}
    </OnboardingIncludedCreditsContext.Provider>
  );
}

export function useOnboardingIncludedCredits(): ContextValue | null {
  return useContext(OnboardingIncludedCreditsContext);
}
