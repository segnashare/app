"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";

import type { SubscriptionOfferTier, SubscriptionPlanLandingContent } from "@/lib/cms/subscription-plan-landing";
import { trackClientEvent } from "@/lib/analytics/track-client";
import { IncludedCreditsSummaryText } from "@/components/onboarding/IncludedCreditsSummaryText";
import {
  dispatchOnboardingOfferClaimed,
  useOnboardingOfferActive,
} from "@/lib/onboarding/onboarding-offer-claimed-event";
import type { WelcomeGiftLandingContent } from "@/lib/cms/welcome-gift-landing";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

const SEGNA_X_LOGO_BLANC_SRC = "/ressources/segnaX_logo_blanc.png";

type PackageSegnaXLandingClientProps = {
  content: SubscriptionPlanLandingContent;
  /** `plan=credits` : cadeau onboarding uniquement (achat packs retiré). */
  planQuery?: "x" | "credits";
  /** Onboarding offer : affiche la frame bonus de crédits offerts. */
  showOfferOnboarding?: boolean;
  /** Contenu CMS cadeau de bienvenue (carte panier `onboarding_offer_only` + `/package?plan=credits`). */
  welcomeGiftContent?: WelcomeGiftLandingContent | null;
};

function defaultSelectedTierIndex(tiers: SubscriptionOfferTier[]): number {
  const featured = tiers.findIndex((t) => t.featured);
  if (featured >= 0) return featured;
  return Math.max(0, tiers.length - 1);
}

export function PackageSegnaXLandingClient({
  content,
  planQuery = "x",
  showOfferOnboarding = false,
  welcomeGiftContent = null,
}: PackageSegnaXLandingClientProps) {
  const router = useRouter();
  const offerOnboardingVisible = useOnboardingOfferActive(showOfferOnboarding);
  const isWelcomeGiftPage = planQuery === "credits";
  const offerTiers = useMemo(() => content.offerTiers, [content.offerTiers]);
  const pageTitle = isWelcomeGiftPage
    ? welcomeGiftContent?.pageTitle?.trim() || "Active tes crédits offerts"
    : (content.pageTitle.trim() || "Devenez membre SegnaX").replace(/^Devenez membre segna X$/i, "Devenez membre SegnaX");

  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(() => defaultSelectedTierIndex(content.offerTiers));
  const [selectedFreeCredits, setSelectedFreeCredits] = useState(showOfferOnboarding || isWelcomeGiftPage);

  const selectedCheckout = useMemo(() => {
    if (selectedFreeCredits || isWelcomeGiftPage) return null;
    const tier = offerTiers[selectedOfferIndex];
    return tier?.checkoutPlanCode ?? content.fallbackCheckoutPlanCode;
  }, [content.fallbackCheckoutPlanCode, isWelcomeGiftPage, offerTiers, selectedFreeCredits, selectedOfferIndex]);

  const primaryCtaLabel = useMemo(() => {
    if (selectedFreeCredits || isWelcomeGiftPage) {
      return welcomeGiftContent?.activateCtaLabel?.trim() || "Activer mes crédits inclus";
    }
    const tier = offerTiers[selectedOfferIndex];
    const synthetic = tier?.syntheticCheckoutCta?.trim();
    if (synthetic) return synthetic;
    const fallback = content.ctaLabel?.trim();
    if (fallback) return fallback;
    return "Continuer vers le paiement";
  }, [content.ctaLabel, isWelcomeGiftPage, offerTiers, selectedFreeCredits, selectedOfferIndex, welcomeGiftContent?.activateCtaLabel]);

  const handleSubscriptionCheckout = async () => {
    if (isCheckoutLoading) return;
    setIsCheckoutLoading(true);
    try {
      if (selectedCheckout) {
        trackClientEvent("subscription_checkout_started", {
          plan_code: selectedCheckout,
          ...(offerTiers[selectedOfferIndex]?.trialPeriodDays != null
            ? { trial_period_days: offerTiers[selectedOfferIndex]!.trialPeriodDays }
            : {}),
        });
      }
      const response = await fetch("/api/stripe/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planCode: selectedCheckout,
          cancelReturnPath: `/package?plan=${planQuery}&checkout=cancelled`,
          ...(offerTiers[selectedOfferIndex]?.trialPeriodDays != null
            ? { trialPeriodDays: offerTiers[selectedOfferIndex]!.trialPeriodDays }
            : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        message?: string;
        code?: string;
      } | null;
      if (response.status === 403 && payload?.code === "phone_not_verified") {
        setIsCheckoutLoading(false);
        router.push(
          `/profile/edit-contact?requirePhone=1&returnPath=${encodeURIComponent(`/package?plan=${planQuery}`)}`,
        );
        return;
      }
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.message ?? "Impossible de rediriger vers Stripe.");
      }
      window.location.assign(payload.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de lancer le paiement.";
      window.alert(message);
      setIsCheckoutLoading(false);
    }
  };

  const handleClaimFreeCredits = async () => {
    if (isCheckoutLoading) return;
    setIsCheckoutLoading(true);
    try {
      const response = await fetch("/api/onboarding/offer/claim", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        creditsAdded?: number;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Impossible d’activer tes crédits inclus.");
      }
      dispatchOnboardingOfferClaimed({ creditsAdded: payload?.creditsAdded });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible d’activer tes crédits inclus.";
      window.alert(message);
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  const handlePrimaryCta = () => {
    if (selectedFreeCredits || isWelcomeGiftPage) return void handleClaimFreeCredits();
    return void handleSubscriptionCheckout();
  };

  return (
    <main className="relative flex min-h-[100dvh] flex-col bg-white">
      <header className="sticky top-0 z-50 mx-auto w-full max-w-[430px] shrink-0 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label="Fermer"
              onClick={() => router.back()}
            >
              <X className="h-8 w-8" strokeWidth={2.25} aria-hidden />
            </button>
            <div className="h-12 w-12 shrink-0" aria-hidden />
          </div>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            {pageTitle}
          </h1>
        </div>
      </header>

      <div className={cn("mx-auto flex w-full max-w-[430px] flex-1 flex-col px-5 pb-6")}>
        <section className="mt-2">
          {/* Même motif que ProfileTabs / rails catalogue : –mx-5 + scroll-pl/pr + spacer w-5 (snap-normal) pour que snap-mandatory ne « mange » pas l’inset gauche). */}
          <div className="-mx-5 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-pl-5 scroll-pr-5 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max max-w-none touch-pan-x gap-3 pr-5">
              <div className="w-5 shrink-0 snap-normal" aria-hidden />
              {offerOnboardingVisible || isWelcomeGiftPage ? (
                <OfferOnboardingCreditFrame
                  content={welcomeGiftContent}
                  selected={selectedFreeCredits}
                  onSelect={() => setSelectedFreeCredits(true)}
                />
              ) : null}
              {!isWelcomeGiftPage
                ? offerTiers.map((tier, idx) => (
                    <OfferTierCard
                      key={`${tier.badge}-${idx}`}
                      tier={tier}
                      selected={!selectedFreeCredits && selectedOfferIndex === idx}
                      onSelect={() => {
                        setSelectedFreeCredits(false);
                        setSelectedOfferIndex(idx);
                      }}
                      highlightAsFeatured={isNouveauOfferTier(tier)}
                      creditPackCard={false}
                    />
                  ))
                : null}
            </div>
          </div>
        </section>

        {isWelcomeGiftPage && welcomeGiftContent ? (
          <IncludedCreditsExplanation content={welcomeGiftContent} />
        ) : null}

        {!isWelcomeGiftPage ? <SegnaXGuestComparisonTable /> : null}
      </div>

      <footer className="mx-auto w-full max-w-[430px] shrink-0 border-t border-zinc-200 bg-white">
        <div className="px-5 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
          <button
            type="button"
            onClick={() => void handlePrimaryCta()}
            disabled={isCheckoutLoading}
            className={cn(
              montserrat.className,
              "inline-flex min-h-[58px] w-full items-center justify-center rounded-full bg-zinc-950 px-3 py-2 text-center text-[15px] font-semibold leading-snug text-white sm:text-[16px] disabled:cursor-not-allowed disabled:opacity-70",
            )}
          >
            {isCheckoutLoading ? "Redirection…" : primaryCtaLabel}
          </button>
          <button
            type="button"
            onClick={() => router.push("/exchange")}
            className={cn(
              montserrat.className,
              "mt-3 inline-flex h-8 w-full items-center justify-center bg-transparent text-[15px] font-semibold text-zinc-900 underline underline-offset-4",
            )}
          >
            Annuler
          </button>
        </div>
      </footer>
    </main>
  );
}

/** Même contenu / structure que le tableau Guest vs SegnaX du site (page Location). */
const SEGNA_X_COMPARE_ROWS: Array<{
  label: string;
  guestCell: string;
  memberCell: string;
}> = [
  {
    label: "Prix de location",
    guestCell: "10 % du prix / semaine\nou 20 % / mois",
    memberCell: "40 € / mois pour 400 € de pièces",
  },
  {
    label: "Durée de location",
    guestCell: "1 semaine ou 1 mois",
    memberCell: "Illimitée",
  },
  {
    label: "Assurance",
    guestCell: "Non incluse",
    memberCell: "Incluse sur taches & petits accidents",
  },
  {
    label: "Frais d’échange",
    guestCell: "10–15 € par échange",
    memberCell: "1 échange inclus / mois",
  },
  {
    label: "Pressing",
    guestCell: "Inclus",
    memberCell: "Inclus",
  },
  {
    label: "Achat des pièces",
    guestCell: "Prix standard",
    memberCell: "30 % de réduction",
  },
];

/** Comparaison Guest vs SegnaX — même tableau que le website. */
function SegnaXGuestComparisonTable() {
  const rows = SEGNA_X_COMPARE_ROWS;
  const gridRows = `auto repeat(${rows.length}, auto)`;

  return (
    <section className="mt-8" aria-labelledby="plan-x-compare-heading">
      <h2 id="plan-x-compare-heading" className="sr-only">
        Comparaison Guest et SegnaX
      </h2>

      <div
        className={cn(montserrat.className, "grid w-full items-stretch")}
        style={{
          gridTemplateColumns: "minmax(5.5rem, 0.85fr) minmax(6.5rem, 1fr) minmax(9.5rem, 1.25fr)",
          gridTemplateRows: gridRows,
        }}
        role="table"
        aria-label="Comparaison Guest et SegnaX"
      >
        <div className="min-h-11" role="columnheader" style={{ gridColumn: 1, gridRow: 1 }}>
          <span className="sr-only">Critère</span>
        </div>
        <div
          className="flex items-center justify-center px-1 py-3 text-center text-[0.82rem] font-bold uppercase tracking-[0.05em] text-zinc-950"
          role="columnheader"
          style={{ gridColumn: 2, gridRow: 1 }}
        >
          Guest
        </div>

        <div
          className="z-[1] grid rounded-2xl bg-zinc-950 text-white [grid-template-rows:subgrid]"
          role="presentation"
          style={{ gridColumn: 3, gridRow: `1 / ${rows.length + 2}` }}
        >
          <div className="flex items-center justify-center px-3 py-3 text-center" role="columnheader">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={SEGNA_X_LOGO_BLANC_SRC}
              alt="SegnaX"
              className="mx-auto h-[1.35rem] w-auto max-w-[5.75rem] object-contain"
              width={120}
              height={39}
            />
          </div>
          {rows.map((row) => (
            <div key={`m-${row.label}`} className="flex items-center px-3.5 py-3.5" role="cell">
              <p className="m-0 text-balance whitespace-pre-line text-[0.82rem] font-semibold leading-snug text-white">
                {row.memberCell}
              </p>
            </div>
          ))}
        </div>

        {rows.map((row, index) => {
          const gridRow = index + 2;
          const isLast = index === rows.length - 1;
          return (
            <div key={row.label} className="contents" role="row">
              <div
                className={cn(
                  "flex min-h-12 items-center py-3.5 pr-2 text-[0.92rem] font-bold tracking-tight text-zinc-950",
                  !isLast && "border-b border-zinc-950/10",
                )}
                role="rowheader"
                style={{ gridColumn: 1, gridRow }}
              >
                {row.label}
              </div>
              <div
                className={cn(
                  "flex min-h-12 items-center justify-center px-2 py-3.5 text-center text-[0.82rem] font-normal leading-snug text-zinc-950/78 whitespace-pre-line",
                  !isLast && "border-b border-zinc-950/10",
                )}
                role="cell"
                style={{ gridColumn: 2, gridRow }}
              >
                {row.guestCell}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function isNouveauOfferTier(tier: SubscriptionOfferTier): boolean {
  return tier.badge.trim().toLowerCase() === "nouveau";
}

function IncludedCreditsExplanation({ content }: { content: WelcomeGiftLandingContent }) {
  return (
    <section className="mt-8" aria-labelledby="included-credits-explainer">
      <h2 id="included-credits-explainer" className="sr-only">
        À quoi servent tes crédits inclus
      </h2>
      <IncludedCreditsSummaryText
        introBody={content.introBody}
        className={cn(montserrat.className, "text-[15px]")}
      />
    </section>
  );
}

function OfferOnboardingCreditFrame({
  content,
  selected,
  onSelect,
}: {
  content: WelcomeGiftLandingContent | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = content?.cardBadge?.trim() || "Crédits offerts";
  const creditsAmount = content?.creditsAmount ?? 100;
  const subtitle = content?.cardSubtitle?.trim() || "crédits offerts";

  return (
    <div
      className={cn(
        montserrat.className,
        "box-border flex w-[min(260px,78vw)] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border-2 border-zinc-950 bg-white text-center shadow-sm transition-[box-shadow,ring] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-zinc-950 has-[:focus-visible]:ring-offset-2",
        selected ? "shadow-[0_0_0_3px_rgb(24_24_27),0_8px_24px_-4px_rgb(0_0_0/0.12)]" : "hover:shadow-md",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex min-h-0 min-w-0 flex-1 flex-col border-0 bg-transparent p-0 text-center text-inherit shadow-none outline-none ring-0 appearance-none hover:bg-transparent focus-visible:outline-none"
      >
        <div className="segna-guidance-shimmer-active segna-guidance-shimmer-target flex min-h-[40px] w-full items-center justify-center bg-zinc-950 px-3 py-2.5 text-[12px] font-semibold leading-tight text-white">
          {badge}
        </div>
        <div className="flex min-h-[104px] flex-1 flex-col items-center justify-center bg-white px-5 py-5 text-center">
          <p className="text-[28px] font-extrabold leading-none tracking-tight text-zinc-950">{creditsAmount}</p>
          <p className="mt-2 text-[17px] font-bold leading-snug text-zinc-950">{subtitle}</p>
        </div>
      </button>
    </div>
  );
}

function OfferTierCard({
  tier,
  selected,
  onSelect,
  highlightAsFeatured,
  creditPackCard = false,
}: {
  tier: SubscriptionOfferTier;
  selected: boolean;
  onSelect: () => void;
  /** Abonnement : pastille « Nouveau » ; packs crédits : palier mis en avant (ex. 500). */
  highlightAsFeatured: boolean;
  /** Packs crédits : bandeau = volume de crédits, corps = prix unitaire (€/crédit) puis prix puis accroche. */
  creditPackCard?: boolean;
}) {
  /** Packs crédits : tout en noir (zinc-950) ; le gris zinc-500 reste pour l’abonnement « Nouveau » / palier mis en avant. */
  const zincSecondaryChrome = highlightAsFeatured && !creditPackCard;

  return (
    <div
      className={cn(
        montserrat.className,
        /* Cadre sur le div : le rail flex étire la hauteur ; un <button> seul centre souvent le bloc à l’intérieur (bandeau décollé du haut). */
        "box-border flex min-h-0 w-[min(260px,78vw)] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border-2 bg-white text-center shadow-sm transition-[box-shadow,ring] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2",
        zincSecondaryChrome
          ? "border-zinc-500 has-[:focus-visible]:ring-zinc-500"
          : "border-zinc-950 has-[:focus-visible]:ring-zinc-950",
        selected
          ? zincSecondaryChrome
            ? "shadow-[0_0_0_3px_rgb(113_113_122),0_8px_24px_-4px_rgb(0_0_0/0.1)]"
            : "shadow-[0_0_0_3px_rgb(24_24_27),0_8px_24px_-4px_rgb(0_0_0/0.12)]"
          : "hover:shadow-md",
      )}
    ><button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex min-h-0 min-w-0 flex-1 flex-col border-0 bg-transparent p-0 text-center text-inherit shadow-none outline-none ring-0 appearance-none hover:bg-transparent focus-visible:outline-none"
        >
        <div
          className={cn(
            /* Pas de rounded sur l’enfant : le parent `overflow-hidden rounded-2xl` clippe — évite le liseré blanc au coin (double rayon + bordure). */
            "flex w-full shrink-0 items-center justify-center px-3 py-2.5 font-semibold leading-tight text-white",
            creditPackCard ? "min-h-[44px] text-[13px] md:text-[14px]" : "min-h-[40px] text-[12px]",
            zincSecondaryChrome ? "bg-zinc-500" : "bg-zinc-950",
          )}
        >
          {tier.badge.trim() ? tier.badge : "\u00a0"}
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-start gap-3 bg-white px-5 py-5 text-center">
          {creditPackCard ? (
            <>
              {tier.title ? (
                <p
                  className={cn(
                    "w-full text-balance leading-none tracking-tight text-zinc-950",
                    "text-[28px] font-extrabold md:text-[30px]",
                  )}
                >
                  {tier.title}
                </p>
              ) : null}
              {tier.subtitle ? (
                <p
                  className={cn(
                    "w-full text-balance text-[14px] leading-snug",
                    tier.title ? "font-normal text-zinc-600" : "font-semibold text-zinc-900",
                  )}
                >
                  {tier.subtitle}
                </p>
              ) : null}
              {tier.priceLine ? (
                <p className="w-full text-balance text-[17px] font-bold leading-none tracking-tight text-zinc-950">{tier.priceLine}</p>
              ) : null}
              {tier.microLine ? (
                <p className="w-full text-balance text-[12px] leading-snug text-zinc-500">{tier.microLine}</p>
              ) : null}
            </>
          ) : tier.promoCard ? (
            <>
              {tier.title.trim() ? (
                <p className="w-full text-balance text-[13px] font-semibold leading-snug text-zinc-700">{tier.title}</p>
              ) : null}
              <p className="w-full text-balance text-[22px] font-extrabold leading-[1.12] tracking-tight text-zinc-950 md:text-[24px]">
                {tier.promoCard.avgPriceDisplay}
              </p>
              <p className="w-full text-balance text-[13px] leading-relaxed text-zinc-600">
                <strong className="font-semibold text-zinc-700">{tier.promoCard.detailBold}</strong>
                {tier.promoCard.detailRest}
              </p>
            </>
          ) : (
            <>
              {tier.title ? (
                <p className="w-full text-balance text-[17px] font-semibold leading-snug tracking-tight text-zinc-950 md:text-[18px]">
                  {tier.title}
                </p>
              ) : null}
              {tier.subtitle ? (
                <p
                  className={cn(
                    "w-full text-balance text-[14px] leading-snug",
                    tier.title ? "font-normal text-zinc-600" : "font-semibold text-zinc-900",
                  )}
                >
                  {tier.subtitle}
                </p>
              ) : null}
              {tier.priceLine ? (
                <p className="w-full text-balance text-[17px] font-bold leading-none tracking-tight text-zinc-950">{tier.priceLine}</p>
              ) : null}
              {tier.microLine ? (
                <p className="w-full text-balance text-[12px] leading-snug text-zinc-500">{tier.microLine}</p>
              ) : null}
            </>
          )}
        </div>
      </button>
    </div>
  );
}
