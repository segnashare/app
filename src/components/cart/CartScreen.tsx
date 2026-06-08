"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info, X } from "lucide-react";

import { segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { SegnaAppBottomSheet, SegnaDialogSheetHandle } from "@/components/ui/SegnaAppBottomSheet";
import { BorrowComplementCheckoutBlock } from "@/components/cart/BorrowComplementCheckoutBlock";
import { BorrowLocationInfoContent } from "@/components/cart/BorrowLocationInfoContent";
import { CartPanierLineRows } from "@/components/cart/CartPanierLineRows";
import { CartPaymentGateModal } from "@/components/cart/CartPaymentGateModal";
import { ExchangeWalletPill } from "@/components/exchange/ExchangeWalletPill";
import {
  computeMissingCreditsCashCents,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";
import {
  clearCheckoutBorrowDurationDays,
  defaultCheckoutBorrowDurationDays,
  readCheckoutBorrowDurationDays,
  resolveCheckoutBorrowDurationDays,
  writeCheckoutBorrowDurationDays,
} from "@/lib/cart/checkout-borrow-duration-storage";
import { exitCartFlow } from "@/lib/cart/pre-cart-exit-path";
import { setCartReservationTimerStart } from "@/lib/cart/reservation-timer";
import { CartCmsShopHubProvider } from "@/components/cart/CartCmsShopHubProvider";
import { CartShopSystemForYouSection } from "@/components/cart/CartShopSystemForYouSection";
import {
  CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS,
  CmsHorizontalScrollRow,
  CmsOnboardingOfferGuidanceProvider,
} from "@/components/cms/CmsSectionBlocks";
import { OnboardingIncludedCreditsProvider } from "@/components/onboarding/OnboardingIncludedCreditsProvider";
import { useOnboardingOfferActive } from "@/lib/onboarding/onboarding-offer-claimed-event";
import type { WelcomeGiftLandingContent } from "@/lib/cms/welcome-gift-landing";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import { sortCartLinesByPriceAsc } from "@/lib/cart/sort-cart-lines-by-price";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { isOnboardingOfferCmsFrame, isPackageCreditsTargetUrl } from "@/lib/cms/welcome-gift-offer-visibility";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { KYC_REQUIRED_FOR_BORROW } from "@/lib/kyc/kyc-policy";
import { cn } from "@/lib/utils/cn";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";

export type { CartLineRowData } from "@/lib/cart/cart-line-row-data";

type OfferCardData = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  accent: string;
};

type CartScreenProps = {
  initialLines: CartLineRowData[];
  /** Panier actif côté serveur (après `reserve_cart_atomic` → `checkout_pending`). */
  activeCartId: string | null;
  cartStatus: string | null;
  membershipLabel: "Guest" | "Membre +" | "Membre X";
  availablePoints: number;
  balanceConsumptionPoints: number;
  balanceExchangePoints: number;
  hasReachedLendingCap: boolean;
  /** Ordre des blocs (RPC CMS + sections à frames). */
  panierSectionOrder?: string[];
  /** Frames + affichage publié par `section_key` (hors `cart_system_*`). */
  cmsSectionsByKey?: Record<string, { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay }>;
  /** Pièces catalogue pour rendu riche des frames `shop_item_ref` (même carte que la boutique). */
  cmsShopHubCatalogItems?: ShopCatalogItem[];
  /** Échantillon catalogue pour le bloc AUTO « Susceptibles de vous plaire » sur le panier (`shop_system_for_you`). */
  cartShopSystemForYouItems?: ShopCatalogItem[];
  /** Onboarding in-app : étape offer, explique les crédits sur le panier. */
  showOfferOnboarding?: boolean;
  /** Activation crédits inclus encore disponible (`onboarding_process === "offer"`). */
  welcomeGiftOfferEligible?: boolean;
  /** Textes + montant (BO) pour la feuille d’activation sur la carte CMS. */
  includedCreditsActivationContent?: WelcomeGiftLandingContent | null;
  /** Profil à 100 % + KYC validé requis pour le paiement. */
  profileComplete?: boolean;
  kycVerified?: boolean;
  /** Durées / tarifs complément crédits (RPC BO economy v2). */
  borrowCheckoutOptions?: BorrowCheckoutOption[];
};

const OFFERS: OfferCardData[] = [
  {
    id: "capsule",
    title: "Capsule du mois",
    subtitle: "Sélection courte, livraison groupée",
    href: "/shop",
    accent: "from-amber-100 to-orange-50",
  },
  {
    id: "essentiels",
    title: "Essentiels d’hiver",
    subtitle: "Manteaux et mailles — points avantageux",
    href: "/shop",
    accent: "from-slate-100 to-zinc-50",
  },
  {
    id: "preorder",
    title: "Pré-réservation",
    subtitle: "Bloque une pièce avant libération",
    href: "/shop",
    accent: "from-rose-50 to-fuchsia-50",
  },
  {
    id: "pret",
    title: "Augmente ta capacité",
    subtitle: "Prête une pièce — gagne des crédits d'échange",
    href: "/exchange",
    accent: "from-emerald-50 to-teal-50",
  },
];

function euros(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

export function CartScreen({
  initialLines,
  activeCartId,
  cartStatus,
  membershipLabel,
  availablePoints,
  balanceConsumptionPoints,
  balanceExchangePoints,
  hasReachedLendingCap,
  panierSectionOrder = ["cart_system_items", "cart_offers", "cart_system_exchange"],
  cmsSectionsByKey = {},
  cmsShopHubCatalogItems = [],
  cartShopSystemForYouItems = [],
  showOfferOnboarding = false,
  welcomeGiftOfferEligible = false,
  includedCreditsActivationContent = null,
  profileComplete = true,
  kycVerified = true,
  borrowCheckoutOptions = [],
}: CartScreenProps) {
  const router = useRouter();
  const offerOnboardingActive = useOnboardingOfferActive(welcomeGiftOfferEligible);
  const showOfferOnboardingUi = useOnboardingOfferActive(showOfferOnboarding);
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const [lines, setLines] = useState<CartLineRowData[]>(() => sortCartLinesByPriceAsc(initialLines));
  const [reserveBusy, setReserveBusy] = useState(false);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [exchangeCreditsModalOpen, setExchangeCreditsModalOpen] = useState(false);
  const [paymentGateModalOpen, setPaymentGateModalOpen] = useState(false);
  const canAccessPayment = profileComplete && (KYC_REQUIRED_FOR_BORROW ? kycVerified : true);
  const [walletPanelOpen, setWalletPanelOpen] = useState(false);
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);
  const [lineRemoveError, setLineRemoveError] = useState<string | null>(null);
  const [borrowDurationDays, setBorrowDurationDays] = useState(() =>
    defaultCheckoutBorrowDurationDays(borrowCheckoutOptions),
  );

  const orderedLines = useMemo(() => sortCartLinesByPriceAsc(lines), [lines]);
  const hasReservedElsewhere = useMemo(() => orderedLines.some((l) => l.reservedByOther), [orderedLines]);
  const cartTotalPoints = useMemo(() => lines.reduce((sum, line) => sum + line.pricePoints, 0), [lines]);

  const competitionItemIdsKey = useMemo(
    () =>
      [...new Set(lines.map((l) => l.itemId))]
        .sort()
        .join(","),
    [lines],
  );

  useEffect(() => {
    if (!competitionItemIdsKey) return;
    const itemIds = competitionItemIdsKey.split(",").filter(Boolean);
    let cancelled = false;

    async function refreshCompetition() {
      const { data, error } = await supabase.rpc("get_cart_items_competition_state", { p_item_ids: itemIds });
      if (cancelled || error) return;
      setLines((prev) => sortCartLinesByPriceAsc(mergeCompetitionIntoCartLines(prev, data)));
    }

    const channel = supabase
      .channel(`cart-competition:${competitionItemIdsKey.slice(0, 120)}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "items",
          filter: `id=in.(${itemIds.join(",")})`,
        },
        () => void refreshCompetition(),
      )
      .subscribe();

    void refreshCompetition();
    const intervalId = window.setInterval(() => void refreshCompetition(), 12000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [competitionItemIdsKey, supabase]);
  const activeCartCostPointsForUi = lines.length === 0 ? null : cartTotalPoints;
  /** Panier total > capacité d’emprunt (wallet). */
  const cartExceedsWallet = activeCartCostPointsForUi != null && cartTotalPoints > availablePoints;
  const missingExchangeMods = cartExceedsWallet ? Math.max(0, cartTotalPoints - availablePoints) : 0;

  useEffect(() => {
    if (!cartExceedsWallet) {
      clearCheckoutBorrowDurationDays();
      return;
    }
    const resolved = resolveCheckoutBorrowDurationDays(
      readCheckoutBorrowDurationDays(),
      borrowCheckoutOptions,
    );
    setBorrowDurationDays(resolved);
    writeCheckoutBorrowDurationDays(resolved);
  }, [borrowCheckoutOptions, cartExceedsWallet]);

  const handleBorrowDurationChange = useCallback((durationDays: number) => {
    setBorrowDurationDays(durationDays);
    writeCheckoutBorrowDurationDays(durationDays);
  }, []);

  const exchangeCreditsEuroCents = cartExceedsWallet
    ? computeMissingCreditsCashCents(missingExchangeMods, borrowDurationDays, borrowCheckoutOptions)
    : 0;
  /** Complément € si le panier dépasse le wallet. */
  const subtotalCashFees = useMemo(() => {
    const creditsEuros = cartExceedsWallet ? exchangeCreditsEuroCents / 100 : 0;
    return creditsEuros;
  }, [cartExceedsWallet, exchangeCreditsEuroCents]);

  useEffect(() => {
    if (!cartExceedsWallet) setExchangeCreditsModalOpen(false);
  }, [cartExceedsWallet]);

  const openPaymentGateOrProceed = () => {
    if (!canAccessPayment) {
      setPaymentGateModalOpen(true);
      return false;
    }
    return true;
  };

  const goToPayment = () => {
    if (!openPaymentGateOrProceed()) return;
    if (hasReservedElsewhere) {
      setReserveError("Une pièce n’est plus disponible — retire-la du panier.");
      return;
    }
    if (!activeCartId) {
      setReserveError("Panier introuvable.");
      return;
    }
    setReserveError(null);
    void goReserveThenPayment();
  };

  const goReserveThenPayment = async () => {
    if (!activeCartId) {
      setReserveError("Panier introuvable.");
      return;
    }
    setReserveError(null);
    setReserveBusy(true);
    try {
      const { data, error } = await supabase.rpc("reserve_cart_atomic", {
        p_cart_id: activeCartId,
        p_hold_ttl_minutes: 10,
        p_lock_ttl_seconds: 600,
      });
      if (error) {
        const raw = (error.message ?? "").toUpperCase();
        const msg = raw.includes("GUEST_RESERVATION_NOT_ALLOWED")
            ? "La réservation du panier n’est pas disponible pour ce compte — réessaie ou contacte le support."
            : raw.includes("ITEM_RESERVED_BY_ANOTHER_MEMBER")
              ? "Une pièce a été réservée par un autre membre — retire-la du panier ou réessaie plus tard."
              : raw.includes("ITEM LOCKS") || raw.includes("LOCKS")
                ? "Verrouillage d’inventaire expiré ou manquant — réessaie depuis le shop."
                : (error.message ?? "Réservation impossible.");
        setReserveError(msg);
        return;
      }
      let payload: { ok?: boolean; already_reserved?: boolean; idempotent?: boolean } | null = null;
      if (data != null && typeof data === "object" && !Array.isArray(data)) {
        payload = data as { ok?: boolean; already_reserved?: boolean; idempotent?: boolean };
      } else if (typeof data === "string") {
        try {
          const parsed = JSON.parse(data) as unknown;
          if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
            payload = parsed as { ok?: boolean; already_reserved?: boolean; idempotent?: boolean };
          }
        } catch {
          payload = null;
        }
      }
      if (payload?.ok) {
        if (!canAccessPayment) {
          setPaymentGateModalOpen(true);
          return;
        }
        const isNewReservation = !payload.already_reserved && !payload.idempotent;
        if (isNewReservation) {
          setCartReservationTimerStart();
        }
        router.push("/cart/payment");
        router.refresh();
      } else {
        setReserveError("Réponse inattendue du serveur — réessaie ou recharge la page.");
      }
    } finally {
      setReserveBusy(false);
    }
  };

  const removeLine = useCallback(
    async (lineId: string) => {
      if (!activeCartId) {
        setLineRemoveError("Panier introuvable.");
        return;
      }
      setLineRemoveError(null);
      setRemovingLineId(lineId);
      try {
        const { data, error } = await supabase
          .from("cart_items")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", lineId)
          .eq("cart_id", activeCartId)
          .is("deleted_at", null)
          .select("id")
          .maybeSingle();
        if (error) {
          setLineRemoveError(error.message ?? "Impossible de retirer cet article.");
          return;
        }
        if (!data) {
          setLineRemoveError("Cette ligne n’a pas pu être retirée.");
          return;
        }
        setLines((prev) => prev.filter((l) => l.id !== lineId));
        try {
          window.dispatchEvent(new CustomEvent("segna:cart-changed"));
        } catch {
          // no-op
        }
        router.refresh();
      } finally {
        setRemovingLineId(null);
      }
    },
    [activeCartId, router, supabase],
  );

  /** Réserve uniquement la hauteur réelle du dock fixe (évite une zone grise scrollable inutile). */
  const scrollBottomPadding = walletPanelOpen
    ? "calc(16px + env(safe-area-inset-bottom, 0px))"
    : "calc(88px + env(safe-area-inset-bottom, 0px))";

  return (
    <OnboardingIncludedCreditsProvider
      active={offerOnboardingActive}
      content={includedCreditsActivationContent}
    >
    <div className="flex w-full flex-col bg-zinc-100">
      <header className="fixed left-1/2 top-0 z-40 w-full max-w-[430px] -translate-x-1/2 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label="Fermer le panier"
              onClick={() => exitCartFlow(router)}
            >
              <X className="h-8 w-8" strokeWidth={2.25} />
            </button>
            <ExchangeWalletPill
              membershipLabel={membershipLabel}
              availablePoints={availablePoints}
              cartExceedsWallet={cartExceedsWallet}
              onWalletPanelOpenChange={setWalletPanelOpen}
              className={cn(
                "relative z-20 min-w-0 max-w-[min(100%,14.5rem)] shrink overflow-hidden",
                welcomeGiftOfferEligible && offerOnboardingActive && "segna-guidance-shimmer-active segna-guidance-shimmer-target",
              )}
            />
          </div>
          <h1 className={cn("mt-5", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Panier</h1>
        </div>
      </header>

      {/* Réserve la place du header fixe ; aligné sur la colonne max-w phone. */}
      <div
        className="mx-auto h-[calc(env(safe-area-inset-top,0px)+8.5rem)] w-full max-w-[430px] shrink-0 bg-white"
        aria-hidden
      />

      <div className="flex flex-col pt-0">
        {/* Entre sections : gutter zinc 4.5px. En bas : réserve dock en blanc (pas de bande zinc comme avec padding-bottom transparent). */}
        <CartCmsShopHubProvider catalogItems={cmsShopHubCatalogItems} onCartMutation={() => router.refresh()}>
          <div className="flex flex-col space-y-[4.5px]">
          {panierSectionOrder.map((slotKey) => {
            if (slotKey === "cart_system_items") {
              return (
                <section key={slotKey} className="bg-white px-5 pb-4 pt-8">
                  {showOfferOnboardingUi ? (
                    <div
                      className="mb-5 rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-[0_8px_28px_rgba(24,24,27,0.07)]"
                      role="status"
                      aria-live="polite"
                    >
                      <h2 className={segnaDialogTitleClass()}>Crédits et capacité</h2>
                      <p className={cn(segnaDialogBodyClass(), "mt-1.5 text-[14px] font-medium text-zinc-600")}>
                        Tu n'as pas encore de crédits. Remplis ton wallet gratuitement !
                      </p>
                    </div>
                  ) : null}
                  {orderedLines.length === 0 ? (
                    <div className="pb-2 pt-1">
                      <p className="text-center text-sm font-medium text-zinc-600">
                        Panier vide — ajoute des pièces depuis le shop.
                      </p>
                    </div>
                  ) : null}

                  <CartPanierLineRows
                    lines={orderedLines}
                    membershipLabel={membershipLabel}
                    availablePoints={availablePoints}
                    removingLineId={removingLineId}
                    lineRemoveError={lineRemoveError}
                    onRemoveLine={(id) => void removeLine(id)}
                  />
                </section>
              );
            }

            if (slotKey === "cart_system_exchange") {
              return (
                <section key={slotKey} className="bg-white px-5 py-4">
                  <div className="flex items-center gap-2">
                    <h2 className={cn("min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
                      Location
                    </h2>
                    {cartExceedsWallet && borrowCheckoutOptions.length > 0 ? (
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={exchangeCreditsModalOpen}
                        aria-controls="cart-exchange-credits-modal"
                        id="cart-exchange-credits-modal-trigger"
                        aria-label="Comment est calculé le montant de location"
                        onClick={() => setExchangeCreditsModalOpen(true)}
                        className="-ml-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
                      >
                        <Info className="h-[18px] w-[18px]" strokeWidth={2.2} />
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <div className="space-y-3">
                      {cartExceedsWallet && borrowCheckoutOptions.length > 0 ? (
                        <BorrowComplementCheckoutBlock
                          options={borrowCheckoutOptions}
                          durationDays={borrowDurationDays}
                          onDurationChange={handleBorrowDurationChange}
                          cartTotalPoints={cartTotalPoints}
                          availablePoints={availablePoints}
                          missingPoints={missingExchangeMods}
                        />
                      ) : null}
                    </div>

                    <div className="mt-6 w-full border-t border-zinc-200 pt-4">
                      <div className="flex w-full items-baseline justify-between gap-3">
                        <span className="text-[20px] font-extrabold leading-tight text-zinc-950">Sous-total</span>
                        <span className="text-[20px] font-extrabold tabular-nums leading-tight text-zinc-950">
                          {euros(subtotalCashFees)}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>
              );
            }

            if (slotKey.startsWith("cart_system_")) {
              return null;
            }

            if (slotKey === "shop_system_for_you") {
              return (
                <CartShopSystemForYouSection key={slotKey} catalogItems={cartShopSystemForYouItems} />
              );
            }

            const cms = cmsSectionsByKey[slotKey] ?? {
              frames: [] as CmsFrameRow[],
              display: { hide_section_title: false, title: null } satisfies CmsSectionPublishedDisplay,
            };
            if (slotKey === "cart_offers" && cms.frames.length === 0) {
              return null;
            }
            const defaultTitle = slotKey === "cart_offers" ? "Des offres pour vous" : "À la une";
            const useStaticOfferFallback = slotKey === "cart_offers" && cms.frames.length === 0;
            const guideOfferFrameCta =
              offerOnboardingActive &&
              slotKey === "cart_offers" &&
              cms.frames.some(
                (row) =>
                  isOnboardingOfferCmsFrame(row) || isPackageCreditsTargetUrl(row.payload?.target_url),
              );

            return (
              <section key={slotKey} className="bg-white px-5 py-4">
                {!cms.display.hide_section_title ? (
                  <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
                    {cms.display.title?.trim() || defaultTitle}
                  </h2>
                ) : null}
                {cms.frames.length > 0 ? (
                  <CmsOnboardingOfferGuidanceProvider active={guideOfferFrameCta}>
                    <CmsHorizontalScrollRow
                      rows={cms.frames}
                      className={cn(
                        cms.display.hide_section_title && "!mt-0",
                        guideOfferFrameCta && "segna-guidance-shimmer-active",
                      )}
                      hubFrameOuterClass={CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS}
                    />
                  </CmsOnboardingOfferGuidanceProvider>
                ) : (
                  <div
                    className={cn(
                      "-mx-5 flex gap-3 overflow-x-auto overflow-y-hidden pb-1 touch-pan-x px-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                      cms.display.hide_section_title ? "mt-0" : "mt-3",
                      !useStaticOfferFallback ? "min-h-[2.5rem] items-center" : "",
                    )}
                  >
                    {useStaticOfferFallback ? (
                      OFFERS.map((offer) => (
                        <Link
                          key={offer.id}
                          href={offer.href}
                          className={cn(
                            "w-[min(240px,calc(100vw-4rem))] shrink-0 overflow-hidden rounded-2xl border border-zinc-200/80 bg-gradient-to-br p-4 shadow-sm",
                            offer.accent,
                          )}
                        >
                          <p className="text-[15px] font-semibold leading-snug text-zinc-900">{offer.title}</p>
                          <p className="mt-1 text-[13px] leading-snug text-zinc-600">{offer.subtitle}</p>
                          <span className="mt-3 inline-flex text-xs font-semibold text-zinc-950">Découvrir →</span>
                        </Link>
                      ))
                    ) : (
                      <p className="w-full px-1 text-center text-[14px] font-medium leading-snug text-zinc-500">
                        Aucune carte publiée pour cette section — enregistrez et publiez des frames dans le back-office.
                      </p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          </div>
        </CartCmsShopHubProvider>

        <div className="shrink-0 bg-white" style={{ height: scrollBottomPadding }} aria-hidden />
      </div>

      {walletPanelOpen ? null : (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
          <div className="pointer-events-auto w-full max-w-[430px] border-t border-zinc-200 bg-white shadow-[0_-12px_32px_rgba(0,0,0,0.08)] pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
            <div className="px-4 pt-3">
            {orderedLines.length === 0 ? (
              <button
                type="button"
                className="flex h-12 w-full cursor-not-allowed items-center justify-center rounded-2xl bg-zinc-400 text-[15px] font-bold text-white"
                disabled
              >
                Réserver le panier
              </button>
            ) : cartStatus === "checkout_pending" ? (
              hasReservedElsewhere ? (
                <p className="text-center text-[13px] font-medium leading-snug text-red-600">
                  Une pièce a été réservée par ailleurs — retire-la avant le paiement.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!openPaymentGateOrProceed()) return;
                    router.push("/cart/payment");
                  }}
                  className={cn(
                    "flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-bold text-white shadow-sm transition",
                    canAccessPayment
                      ? "bg-zinc-950 active:bg-zinc-800"
                      : "cursor-pointer bg-zinc-400",
                  )}
                >
                  Passer au paiement
                </button>
              )
            ) : (
              <div className="w-full space-y-2">
                <button
                  type="button"
                  disabled={reserveBusy || !activeCartId || hasReservedElsewhere}
                  onClick={() => goToPayment()}
                  className={cn(
                    "flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-bold text-white shadow-sm transition disabled:opacity-60",
                    canAccessPayment
                      ? "bg-zinc-950 active:bg-zinc-800"
                      : "cursor-pointer bg-zinc-400",
                  )}
                >
                  {reserveBusy ? "Réservation…" : "Réserver le panier"}
                </button>
                {reserveError ? (
                  <p className="text-center text-[13px] font-medium leading-snug text-red-600">{reserveError}</p>
                ) : null}
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      <CartPaymentGateModal
        open={paymentGateModalOpen}
        onClose={() => setPaymentGateModalOpen(false)}
        profileComplete={profileComplete}
        kycVerified={kycVerified}
      />

      <SegnaAppBottomSheet
        open={exchangeCreditsModalOpen && cartExceedsWallet}
        onClose={() => setExchangeCreditsModalOpen(false)}
        dialogId="cart-exchange-credits-modal"
        labelledBy="cart-exchange-credits-modal-title"
        zIndexClassName="z-[100]"
      >
        <SegnaDialogSheetHandle />
        <h2 id="cart-exchange-credits-modal-title" className={segnaDialogTitleClass()}>
          Location
        </h2>
        <div className="mt-5 space-y-4">
          <BorrowLocationInfoContent />
          <p className={segnaDialogBodyClass()}>
            Pour réduire le complément,{" "}
            <Link
              href="/items/new"
              className="font-semibold text-zinc-900 underline underline-offset-2"
              onClick={() => setExchangeCreditsModalOpen(false)}
            >
              prête des pièces
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExchangeCreditsModalOpen(false)}
          className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
        >
          OK
        </button>
      </SegnaAppBottomSheet>
    </div>
    </OnboardingIncludedCreditsProvider>
  );
}
