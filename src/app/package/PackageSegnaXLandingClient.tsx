"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";

import type { SubscriptionOfferTier, SubscriptionPlanLandingContent } from "@/lib/cms/subscription-plan-landing";
import type { WelcomeGiftLandingContent } from "@/lib/cms/welcome-gift-landing";
import {
  PLAN_ENTITLEMENT_COMPARISON_FALLBACK,
  type PlanEntitlementComparisonLimits,
} from "@/lib/billing/fetch-plan-entitlement-comparison-limits";
import {
  CREDIT_PACK_AMOUNTS,
  CREDIT_PACK_DISPLAY,
  creditPackUnitEuroPerCreditLabel,
  type CreditPackAmount,
} from "@/lib/stripe/credit-packs";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

const SEGNA_X_LOGO_BLANC_SRC = "/ressources/segnaX_logo_blanc.png";

const CREDITS_LANDING_VALUE_PROPS: { title: string; body: string }[] = [
  {
    title: "Plus de crédits",
    body: "Ajoute des crédits à ton compte pour accéder à plus de pièces dans le dressing partagé.",
  },
  {
    title: "Plus de looks",
    body: "Compose plus de paniers et emprunte selon tes envies, sans changer de formule.",
  },
  {
    title: "Plus de liberté",
    body: "Achète des crédits uniquement quand tu en as besoin, sans engagement mensuel.",
  },
];

function creditPackOfferTiers(): SubscriptionOfferTier[] {
  return CREDIT_PACK_AMOUNTS.map((pack) => {
    const d = CREDIT_PACK_DISPLAY[pack];
    return {
      badge: d.headerTitle,
      title: creditPackUnitEuroPerCreditLabel(pack),
      subtitle: "",
      priceLine: d.priceLine,
      microLine: d.tagline,
      featured: d.featured,
      checkoutPlanCode: "segna_x",
    };
  });
}

type PackageSegnaXLandingClientProps = {
  content: SubscriptionPlanLandingContent;
  /** Alias URL de la même landing SegnaX (`plan=x` | `plan=credits`) — utilisé pour le retour annulation Stripe. */
  planQuery?: "x" | "credits";
  /** SegnaX (`plan=x`) : abonnement réservé aux comptes avec KYC validé (sinon redirection profil). */
  identityVerifiedForSubscription?: boolean;
  /** Onboarding offer : affiche la frame bonus de crédits offerts. */
  showOfferOnboarding?: boolean;
  /** Contenu CMS cadeau de bienvenue (carte panier `onboarding_offer_only` + `/package?plan=credits`). */
  welcomeGiftContent?: WelcomeGiftLandingContent | null;
  /** Plafonds affichés dans le comparatif (source `billing_plan_entitlement_limits`, chargé en SSR pour `plan=x`). */
  planEntitlementComparisonLimits?: PlanEntitlementComparisonLimits;
};

const KYC_SUBSCRIPTION_HREF = "/profile/kyc?tab=me";

function defaultSelectedTierIndex(tiers: SubscriptionOfferTier[]): number {
  const featured = tiers.findIndex((t) => t.featured);
  if (featured >= 0) return featured;
  return Math.max(0, tiers.length - 1);
}

export function PackageSegnaXLandingClient({
  content,
  planQuery = "x",
  identityVerifiedForSubscription = true,
  showOfferOnboarding = false,
  welcomeGiftContent = null,
  planEntitlementComparisonLimits,
}: PackageSegnaXLandingClientProps) {
  const router = useRouter();
  const isCreditsLanding = planQuery === "credits";
  const subscriptionBlockedByKyc = planQuery === "x" && !identityVerifiedForSubscription;
  const offerTiers = useMemo(
    () => (planQuery === "credits" ? creditPackOfferTiers() : content.offerTiers),
    [planQuery, content.offerTiers],
  );
  const pageTitle = isCreditsLanding
    ? "Obtenir plus de crédits"
    : (content.pageTitle.trim() || "Devenez membre SegnaX").replace(/^Devenez membre segna X$/i, "Devenez membre SegnaX");
  const valueProps = isCreditsLanding ? CREDITS_LANDING_VALUE_PROPS : content.valueProps;
  const footnote = isCreditsLanding
    ? "Les crédits achetés s'ajoutent à ton solde existant et peuvent être utilisés sur les pièces disponibles dans le dressing partagé, selon les conditions en vigueur."
    : null;

  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(() =>
    defaultSelectedTierIndex(planQuery === "credits" ? creditPackOfferTiers() : content.offerTiers),
  );
  const [selectedFreeCredits, setSelectedFreeCredits] = useState(showOfferOnboarding);

  const selectedCheckout = useMemo(() => {
    if (selectedFreeCredits) return null;
    const tier = offerTiers[selectedOfferIndex];
    return tier?.checkoutPlanCode ?? content.fallbackCheckoutPlanCode;
  }, [content.fallbackCheckoutPlanCode, offerTiers, selectedFreeCredits, selectedOfferIndex]);

  const selectedCreditPack: CreditPackAmount | null = useMemo(() => {
    if (!isCreditsLanding || selectedFreeCredits) return null;
    return CREDIT_PACK_AMOUNTS[selectedOfferIndex] ?? null;
  }, [isCreditsLanding, selectedFreeCredits, selectedOfferIndex]);

  const primaryCtaLabel = useMemo(() => {
    if (selectedFreeCredits) {
      return welcomeGiftContent?.ctaLabel?.trim() || "Profiter des crédits gratuits";
    }
    if (subscriptionBlockedByKyc) {
      return "Vérifier d'abord mon identité";
    }
    if (isCreditsLanding) {
      const pack = CREDIT_PACK_AMOUNTS[selectedOfferIndex];
      if (!pack) return "Continuer vers le paiement";
      const d = CREDIT_PACK_DISPLAY[pack];
      return `${d.headerTitle} pour ${d.priceLine}`;
    }
    const tier = offerTiers[selectedOfferIndex];
    const synthetic = tier?.syntheticCheckoutCta?.trim();
    if (synthetic) return synthetic;
    const fallback = content.ctaLabel?.trim();
    if (fallback) return fallback;
    return "Continuer vers le paiement";
  }, [content.ctaLabel, isCreditsLanding, offerTiers, selectedFreeCredits, selectedOfferIndex, subscriptionBlockedByKyc, welcomeGiftContent?.ctaLabel]);

  const handleSubscriptionCheckout = async () => {
    if (subscriptionBlockedByKyc) {
      router.push(KYC_SUBSCRIPTION_HREF);
      return;
    }
    if (isCheckoutLoading) return;
    setIsCheckoutLoading(true);
    try {
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
      const payload = (await response.json().catch(() => null)) as { url?: string; message?: string } | null;
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
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Impossible de créditer le wallet.");
      }
      router.push("/exchange");
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de créditer le wallet.";
      window.alert(message);
      setIsCheckoutLoading(false);
    }
  };

  const handleCreditsCheckout = async () => {
    if (isCheckoutLoading || !selectedCreditPack) return;
    setIsCheckoutLoading(true);
    try {
      const response = await fetch("/api/stripe/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: selectedCreditPack }),
      });
      const payload = (await response.json().catch(() => null)) as { url?: string; message?: string } | null;
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

  const handlePrimaryCta = () => {
    if (selectedFreeCredits) return void handleClaimFreeCredits();
    if (isCreditsLanding) return void handleCreditsCheckout();
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
              {showOfferOnboarding ? (
                <OfferOnboardingCreditFrame
                  content={welcomeGiftContent}
                  selected={selectedFreeCredits}
                  onSelect={() => setSelectedFreeCredits(true)}
                />
              ) : null}
              {offerTiers.map((tier, idx) => (
                <OfferTierCard
                  key={`${tier.badge}-${idx}`}
                  tier={tier}
                  selected={!selectedFreeCredits && selectedOfferIndex === idx}
                  onSelect={() => {
                    setSelectedFreeCredits(false);
                    setSelectedOfferIndex(idx);
                  }}
                  highlightAsFeatured={isCreditsLanding ? tier.featured : isNouveauOfferTier(tier)}
                  creditPackCard={isCreditsLanding}
                />
              ))}
            </div>
          </div>
        </section>

        {isCreditsLanding ? (
          <section className="mt-8 space-y-0">
            {valueProps.map((row, idx) => (
              <div key={`${row.title}-${idx}`}>
                {idx > 0 ? <div className="my-4 h-px w-full bg-zinc-200" /> : null}
                <article className="space-y-1.5">
                  <h2 className={cn(montserrat.className, "text-[20px] font-semibold text-zinc-950 md:text-[22px]")}>
                    {row.title}
                  </h2>
                  <p className={cn(montserrat.className, "text-[14px] leading-snug text-zinc-600 md:text-[16px]")}>
                    {row.body}
                  </p>
                </article>
              </div>
            ))}
          </section>
        ) : (
          <SegnaXGuestComparisonTable
            limits={{ ...PLAN_ENTITLEMENT_COMPARISON_FALLBACK, ...planEntitlementComparisonLimits }}
          />
        )}

        {footnote ? (
          <p className={cn(montserrat.className, "mt-8 text-center text-[12px] leading-snug text-zinc-600")}>
            {footnote}
          </p>
        ) : null}
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

/** Comparaison Guest vs SegnaX sous les offres (landing abonnement uniquement). Valeurs numériques = `billing_plan_entitlement_limits`. */
function SegnaXGuestComparisonTable({ limits }: { limits: PlanEntitlementComparisonLimits }) {
  const rows = useMemo(() => {
    const go = limits.guestIncludedOrders;
    const gc = limits.guestMonthlyCredits;
    const xo = limits.segnaXIncludedOrders;
    const xc = limits.segnaXMonthlyCredits;
    const guestExchangesSr = `${go} échange${go !== 1 ? "s" : ""} inclus`;
    const guestCreditsSr = `${gc} crédit${gc !== 1 ? "s" : ""} mensuel${gc !== 1 ? "s" : ""} inclus`;

    const numCell = (n: number) => (
      <span className="text-[17px] font-bold tabular-nums text-white">{n}</span>
    );
    const guestNumCell = (n: number) => (
      <span className="text-[17px] font-semibold tabular-nums text-zinc-600">{n}</span>
    );

    return [
      {
        label: "Échanges inclus",
        guestSr: guestExchangesSr,
        guestDisplay: guestNumCell(go),
        segnaX: numCell(xo),
        segnaXLabel: `${xo} échange${xo !== 1 ? "s" : ""} inclus`,
      },
      {
        label: "Crédits mensuels",
        guestSr: guestCreditsSr,
        guestDisplay: guestNumCell(gc),
        segnaX: numCell(xc),
        segnaXLabel: `${xc} crédit${xc !== 1 ? "s" : ""} mensuel${xc !== 1 ? "s" : ""} inclus`,
      },
      {
        label: "Réservation",
        guestSr: "Non inclus",
        guestDisplay: null as ReactNode,
        segnaX: <Check className="mx-auto h-5 w-5 text-white" strokeWidth={2.5} aria-hidden />,
        segnaXLabel: "Réservation prioritaire incluse",
      },
      {
        label: "Pièces premium",
        guestSr: "Non inclus",
        guestDisplay: null as ReactNode,
        segnaX: <Check className="mx-auto h-5 w-5 text-white" strokeWidth={2.5} aria-hidden />,
        segnaXLabel: "Accès aux pièces premium",
      },
    ];
  }, [limits]);

  return (
    <section className="mt-8" aria-labelledby="plan-x-compare-heading">
      <h2 id="plan-x-compare-heading" className="sr-only">
        Comparaison Guest et SegnaX
      </h2>
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr className={cn(montserrat.className, "text-[11px] font-semibold uppercase tracking-wide text-zinc-500")}>
            <th
              scope="col"
              className="w-[34%] border-b border-zinc-200 bg-white px-3 py-3.5 font-semibold normal-case tracking-normal text-zinc-500"
            >
              <span className="sr-only">Critères</span>
            </th>
            <th
              scope="col"
              className="border-b border-zinc-200 bg-white px-2 py-3.5 text-center text-zinc-950 sm:px-3"
            >
              <span className={cn(montserrat.className, "text-[12px] font-bold uppercase tracking-wide")}>Guest</span>
            </th>
            <th
              scope="col"
              className="rounded-t-2xl border-l-2 border-r-2 border-t-2 border-zinc-950 bg-zinc-950 px-2 py-2.5 text-center text-white sm:px-3"
            >
              <img
                src={SEGNA_X_LOGO_BLANC_SRC}
                alt="SegnaX"
                className="mx-auto h-[1.25rem] w-auto max-w-[5rem] object-contain sm:h-[1.125rem] sm:max-w-[5.25rem]"
              />
            </th>
          </tr>
        </thead>
        <tbody className={cn(montserrat.className, "text-[13px] leading-snug sm:text-[14px]")}>
          {rows.map((row, rowIndex) => {
            const isLast = rowIndex === rows.length - 1;
            return (
              <tr key={row.label}>
                <th
                  scope="row"
                  className={cn(
                    "bg-white px-3 py-4 font-semibold text-zinc-950 sm:py-5",
                    !isLast && "border-b border-zinc-200",
                  )}
                >
                  {row.label}
                </th>
                <td
                  className={cn(
                    "bg-white px-2 py-4 text-center text-zinc-600 sm:px-3",
                    !isLast && "border-b border-zinc-200",
                  )}
                >
                  <span className="sr-only">{row.guestSr}</span>
                  {row.guestDisplay ? <span aria-hidden>{row.guestDisplay}</span> : null}
                </td>
                <td
                  className={cn(
                    "border-x-2 border-zinc-950 bg-zinc-950 px-2 py-4 text-center text-white sm:px-3",
                    rowIndex === 0 && "border-t-2 border-white",
                    isLast
                      ? "rounded-b-2xl border-b-2 border-zinc-950"
                      : "border-b border-white/50",
                  )}
                >
                  <span className="sr-only">{row.segnaXLabel}</span>
                  <span aria-hidden>{row.segnaX}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function isNouveauOfferTier(tier: SubscriptionOfferTier): boolean {
  return tier.badge.trim().toLowerCase() === "nouveau";
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
  const creditsAmount = content?.creditsAmount ?? 250;
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
