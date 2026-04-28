"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";

import type { SubscriptionOfferTier, SubscriptionPlanLandingContent } from "@/lib/cms/subscription-plan-landing";
import { CREDIT_PACK_AMOUNTS, CREDIT_PACK_DISPLAY, type CreditPackAmount } from "@/lib/stripe/credit-packs";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

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
      title: d.discountLine,
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
    : content.footnote;

  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(() =>
    defaultSelectedTierIndex(planQuery === "credits" ? creditPackOfferTiers() : content.offerTiers),
  );

  const selectedCheckout = useMemo(() => {
    const tier = offerTiers[selectedOfferIndex];
    return tier?.checkoutPlanCode ?? content.fallbackCheckoutPlanCode;
  }, [content.fallbackCheckoutPlanCode, offerTiers, selectedOfferIndex]);

  const selectedCreditPack: CreditPackAmount | null = useMemo(() => {
    if (!isCreditsLanding) return null;
    return CREDIT_PACK_AMOUNTS[selectedOfferIndex] ?? null;
  }, [isCreditsLanding, selectedOfferIndex]);

  const primaryCtaLabel = useMemo(() => {
    if (subscriptionBlockedByKyc) {
      return "Vérifier mon identité (KYC)";
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
  }, [content.ctaLabel, isCreditsLanding, offerTiers, selectedOfferIndex, subscriptionBlockedByKyc]);

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
        {subscriptionBlockedByKyc ? (
          <div
            className={cn(
              montserrat.className,
              "mt-3 rounded-2xl border border-amber-200/90 bg-amber-50 px-4 py-3.5 text-[13px] leading-snug text-amber-950",
            )}
            role="status"
          >
            <p className="font-semibold text-amber-950">Vérification d’identité requise</p>
            <p className="mt-1.5 text-[13px] text-amber-900/90">
              L’abonnement SegnaX n’est disponible qu’après validation du KYC (pièce d’identité).
            </p>
            <button
              type="button"
              onClick={() => router.push(KYC_SUBSCRIPTION_HREF)}
              className="mt-2.5 text-left text-[14px] font-semibold text-amber-950 underline underline-offset-2"
            >
              Aller à la vérification d’identité
            </button>
          </div>
        ) : null}
        <section className="mt-2">
          {/* Même motif que ProfileTabs / rails catalogue : –mx-5 + scroll-pl/pr + spacer w-5 (snap-normal) pour que snap-mandatory ne « mange » pas l’inset gauche). */}
          <div className="-mx-5 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-pl-5 scroll-pr-5 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max max-w-none touch-pan-x gap-3 pr-5">
              <div className="w-5 shrink-0 snap-normal" aria-hidden />
              {offerTiers.map((tier, idx) => (
                <OfferTierCard
                  key={`${tier.badge}-${idx}`}
                  tier={tier}
                  selected={selectedOfferIndex === idx}
                  onSelect={() => setSelectedOfferIndex(idx)}
                  highlightAsFeatured={isCreditsLanding ? tier.featured : isNouveauOfferTier(tier)}
                  creditPackCard={isCreditsLanding}
                />
              ))}
            </div>
          </div>
        </section>

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

function isNouveauOfferTier(tier: SubscriptionOfferTier): boolean {
  return tier.badge.trim().toLowerCase() === "nouveau";
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
  /** Packs crédits : bandeau = volume de crédits, corps = réduction puis prix puis accroche. */
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
