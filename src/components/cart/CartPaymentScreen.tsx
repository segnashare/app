"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Check, ChevronLeft, ChevronRight, Store, User } from "lucide-react";

import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import { SendcloudServicePointPicker } from "@/components/cart/SendcloudServicePointPicker";
import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import { segnaDialogBodyClass, segnaDialogTitleClass, SEGNA_DIALOG_SHEET_CLASS } from "@/components/ui/SegnaAppDialog";
import {
  readCheckoutDeliveryAddress,
  readCheckoutDeliveryChannel,
  readCheckoutDeliveryInstructions,
  readCheckoutHomeSpeed,
  readCheckoutRelaySelection,
  writeCheckoutDeliveryAddress,
  writeCheckoutDeliveryChannel,
  writeCheckoutDeliveryInstructions,
  writeCheckoutHomeSpeed,
  writeCheckoutRelaySelection,
  type CheckoutDeliveryAddress,
  type CheckoutRelaySelection,
} from "@/lib/cart/checkout-delivery-storage";
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
import { checkoutHomePlanEtaSubtitle } from "@/lib/cart/checkout-home-plan-display";
import { CART_CHECKOUT_VAT_LABEL, htToVatAndTtcCents } from "@/lib/cart/cart-checkout-vat";
import {
  computeCartCheckoutFeesWithServiceRoundUp,
  computeCartCheckoutIncludedFeeReductions,
  computeCartCheckoutNetFees,
} from "@/lib/cart/cart-payment-fees";
import {
  computeCartCheckoutRoundTripShippingHtCents,
} from "@/lib/billing/cart-checkout-shipping-ht-cents";
import type { IncludedExchangeShippingKind } from "@/lib/billing/included-exchange-shipping";
import { formatIncludedShippingQuotaLabel } from "@/lib/billing/membership-included-orders";
import type { MembershipLabel } from "@/lib/user/resolve-membership-label";
import { exitCartFlow } from "@/lib/cart/pre-cart-exit-path";
import { CART_RESERVED_AT_STORAGE_KEY } from "@/lib/cart/reservation-timer";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
import {
  readCheckoutSendcloudOutboundOption,
  writeCheckoutSendcloudOutboundOption,
} from "@/lib/cart/checkout-sendcloud-outbound-option";
import { memberPostalCodeForCheckoutShipping } from "@/lib/cart/checkout-shipping-postal";
import {
  toHomeCheckoutSendcloudOutboundOption,
  useCheckoutHomeSendcloudPricing,
} from "@/lib/cart/use-checkout-home-sendcloud-pricing";
import type { CheckoutHomeMethodOption } from "@/lib/sendcloud/checkout-home-delivery-options";
import {
  toRelayCheckoutSendcloudOutboundOption,
  useCheckoutRelaySendcloudPricing,
} from "@/lib/cart/use-checkout-relay-sendcloud-pricing";
import { toCheckoutSendcloudOutboundOption } from "@/lib/cart/use-sendcloud-outbound-delivery-options";
import { useSendcloudCheckoutShippingQuote } from "@/lib/cart/use-sendcloud-checkout-shipping-quote";
import { formatCheckoutRelayDisplayLabel } from "@/lib/sendcloud/relay-point-ref";
import { centsToEuros } from "@/lib/shipping/exchange-shipping-pricing";
import { buildUberMemberArrivalLineFr, uberQuoteFeeCentsFromRaw } from "@/lib/uber-direct/format-quote-for-display";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { CheckoutHomePlanCarrierIcon } from "@/components/cart/CheckoutHomePlanCarrierIcon";
import {
  UberDirectQuotePanel,
  uberDirectUnavailablePriceLabel,
  type UberDirectQuotePhase,
} from "@/components/cart/UberDirectQuotePanel";
import { UberWordmarkIcon } from "@/components/icons/UberWordmarkIcon";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const TIMER_MS = 10 * 60 * 1000;
const RELAY_SEARCH_WEIGHT_G = 900;

function euros(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

type DeliveryChannel = "relay" | "home";
type HomeDeliverySpeed = "standard" | "uber_direct";

function formatMmSs(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Évite d’afficher les détails techniques (env serveur) aux membres. */
function userFacingRelaySearchError(status: number, raw?: string): string {
  const t = (raw ?? "").trim();
  if (status === 501 || /MONDR_RELAY|configuration transporteur|indisponible\s*:\s*configuration/i.test(t)) {
    return "Recherche de points relais momentanément indisponible. Tu peux choisir la livraison à domicile ou réessayer plus tard.";
  }
  if (status === 401) return "Connecte-toi pour rechercher un point relais.";
  if (status === 502 || status === 503) {
    return "Le service relais ne répond pas. Réessaie dans quelques instants ou passe en livraison à domicile.";
  }
  if (t) return t;
  return `Erreur ${status}`;
}

type CartPaymentScreenProps = {
  initialLines: CartLineRowData[];
  /** Unité de crédit affichée (consommation vs échange), alignée commande / échange. */
  walletCreditKind: WalletCreditKind;
  /**
   * Crédits manquants au-delà du solde wallet (complément € selon durée choisie).
   */
  missingExchangeMods: number;
  borrowCheckoutOptions: BorrowCheckoutOption[];
  /** Solde wallet au moment du chargement (complément d’échange vs couverture). */
  availableWalletMods: number;
  /** Invité : pas de compteur explicite en tête (réservation serveur inchangée). */
  hideReservationTimer?: boolean;
  /**
   * Livraison échange prise en charge selon le plan : membre = tout mode ; invité = valeur d’un aller-retour relais
   * (`included_orders_limit` sur `guest` dans `billing_plan_entitlement_limits`).
   */
  includedExchangeShipping?: IncludedExchangeShippingKind;
  /** Repère affichage / cohérence avec le serveur au chargement de la page. */
  remainingIncludedOrdersThisMonth?: number;
  /** Plafond mensuel `included_orders_limit` (pour affichage type 1/2). */
  includedOrdersLimitThisMonth?: number;
  membershipLabel?: MembershipLabel;
  subscriptionIncludedOrdersRemaining?: number;
  /** Sous-titre bleu sous Mondial Relay (forfait SegnaX / Segna+). */
  includedShippingForfaitLine?: string;
  /** Retour Stripe `/api/stripe/cart/sync` en erreur (débit wallet ou confirmation panier). */
  postStripeSyncError?: { reason: string; detail?: string } | null;
  /** Adresse du profil, utilisée comme valeur par défaut tant que le checkout n'a pas sa propre adresse. */
  initialProfileDeliveryAddress?: CheckoutDeliveryAddress | null;
  /** Flags Sendcloud (SSR) — évite le flash liste MR avant la carte relais. */
  initialSendcloudFeatures?: {
    relaySearch: boolean;
    servicePointPicker: boolean;
    checkoutLivePricing: boolean;
    checkoutConfigured: boolean;
  };
};

function extractPostalCodeFromAddress(address: CheckoutDeliveryAddress | null | undefined): string {
  const source = [address?.label, address?.city, address?.relativeCity]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return source.match(/\b\d{5}\b/)?.[0] ?? "";
}

export function CartPaymentScreen({
  initialLines,
  walletCreditKind,
  missingExchangeMods,
  borrowCheckoutOptions,
  availableWalletMods,
  hideReservationTimer = false,
  includedExchangeShipping = "none",
  remainingIncludedOrdersThisMonth = 0,
  includedOrdersLimitThisMonth = 0,
  membershipLabel = "Guest",
  subscriptionIncludedOrdersRemaining = 0,
  includedShippingForfaitLine,
  postStripeSyncError = null,
  initialProfileDeliveryAddress = null,
  initialSendcloudFeatures,
}: CartPaymentScreenProps) {
  const router = useRouter();
  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>("relay");
  const [homeSpeed, setHomeSpeed] = useState<HomeDeliverySpeed>("standard");
  const checkoutUiPrefsRestoredRef = useRef(false);
  const [relayPostal, setRelayPostal] = useState("");
  const [relayPoints, setRelayPoints] = useState<CheckoutRelaySelection[]>([]);
  const relayListScrollRef = useRef<HTMLUListElement>(null);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relaySearchError, setRelaySearchError] = useState<string | null>(null);
  const [sendcloudRelaySearch, setSendcloudRelaySearch] = useState(
    () => initialSendcloudFeatures?.relaySearch ?? false,
  );
  const [sendcloudSpp, setSendcloudSpp] = useState(
    () => initialSendcloudFeatures?.servicePointPicker ?? false,
  );
  const [sendcloudLivePricing, setSendcloudLivePricing] = useState(
    () => initialSendcloudFeatures?.checkoutLivePricing ?? false,
  );
  const [sendcloudCheckoutConfigured, setSendcloudCheckoutConfigured] = useState(
    () => initialSendcloudFeatures?.checkoutConfigured ?? false,
  );
  const [sendcloudStatusLoaded, setSendcloudStatusLoaded] = useState(
    () => initialSendcloudFeatures != null,
  );
  const [selectedRelay, setSelectedRelay] = useState<CheckoutRelaySelection | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState<CheckoutDeliveryAddress | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [instructionsSaved, setInstructionsSaved] = useState("");
  const [feesModalOpen, setFeesModalOpen] = useState(false);
  const [rentalTermsAccepted, setRentalTermsAccepted] = useState(false);
  const [remainingMs, setRemainingMs] = useState(TIMER_MS);
  const [stripeCheckoutBusy, setStripeCheckoutBusy] = useState(false);
  const [stripeCheckoutError, setStripeCheckoutError] = useState<string | null>(null);
  const [borrowDurationDays, setBorrowDurationDays] = useState(() =>
    defaultCheckoutBorrowDurationDays(borrowCheckoutOptions),
  );
  const [uberQuote, setUberQuote] = useState<Record<string, unknown> | null>(null);
  const [uberQuoteFetch, setUberQuoteFetch] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [uberQuoteError, setUberQuoteError] = useState<string | null>(null);
  const [uberQuoteErrorCode, setUberQuoteErrorCode] = useState<string | null>(null);
  const [uberQuoteErrorDetail, setUberQuoteErrorDetail] = useState<string | null>(null);
  const uberQuoteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultRelayPostalCode = useMemo(
    () => extractPostalCodeFromAddress(initialProfileDeliveryAddress),
    [initialProfileDeliveryAddress],
  );

  const refreshCheckoutLocalState = useCallback(() => {
    const savedDeliveryAddress = readCheckoutDeliveryAddress();
    const nextDeliveryAddress = savedDeliveryAddress ?? initialProfileDeliveryAddress;
    setDeliveryAddress(nextDeliveryAddress);
    if (!savedDeliveryAddress && nextDeliveryAddress) {
      writeCheckoutDeliveryAddress(nextDeliveryAddress);
    }
    setInstructionsDraft(readCheckoutDeliveryInstructions());
    setInstructionsSaved(readCheckoutDeliveryInstructions());
    const savedRelaySelection = readCheckoutRelaySelection();
    setSelectedRelay(savedRelaySelection);
    setRelayPostal((current) => current || savedRelaySelection?.postalCode || defaultRelayPostalCode);
  }, [defaultRelayPostalCode, initialProfileDeliveryAddress]);

  useEffect(() => {
    refreshCheckoutLocalState();
  }, [refreshCheckoutLocalState]);

  useEffect(() => {
    if (missingExchangeMods <= 0) {
      clearCheckoutBorrowDurationDays();
      return;
    }
    const resolved = resolveCheckoutBorrowDurationDays(
      readCheckoutBorrowDurationDays(),
      borrowCheckoutOptions,
    );
    setBorrowDurationDays(resolved);
    writeCheckoutBorrowDurationDays(resolved);
  }, [borrowCheckoutOptions, missingExchangeMods]);

  const exchangeCreditsEuroCents = useMemo(
    () =>
      missingExchangeMods > 0
        ? computeMissingCreditsCashCents(missingExchangeMods, borrowDurationDays, borrowCheckoutOptions)
        : 0,
    [borrowCheckoutOptions, borrowDurationDays, missingExchangeMods],
  );
  const exchangeCreditsChargeEuros = exchangeCreditsEuroCents / 100;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/items/sendcloud/status");
        if (!res.ok) return;
        const j = (await res.json()) as {
          relay_search_enabled?: boolean;
          service_point_picker_enabled?: boolean;
          checkout_live_pricing_enabled?: boolean;
          checkout_configuration_id?: string | null;
        };
        if (!cancelled) {
          setSendcloudRelaySearch(Boolean(j.relay_search_enabled));
          setSendcloudSpp(Boolean(j.service_point_picker_enabled));
          setSendcloudLivePricing(Boolean(j.checkout_live_pricing_enabled));
          setSendcloudCheckoutConfigured(j.checkout_configuration_id === "set");
          setSendcloudStatusLoaded(true);
        }
      } catch {
        if (!cancelled) setSendcloudStatusLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (checkoutUiPrefsRestoredRef.current) return;
    checkoutUiPrefsRestoredRef.current = true;
    const ch = readCheckoutDeliveryChannel();
    const sp = readCheckoutHomeSpeed();
    if (ch === "relay" || ch === "home") setDeliveryChannel(ch);
    if (sp === "standard" || sp === "uber_direct") setHomeSpeed(sp);
  }, []);

  const persistDeliveryChannel = useCallback((ch: DeliveryChannel) => {
    setDeliveryChannel(ch);
    writeCheckoutDeliveryChannel(ch);
  }, []);

  const persistHomeSpeed = useCallback((sp: HomeDeliverySpeed) => {
    setHomeSpeed(sp);
    writeCheckoutHomeSpeed(sp);
  }, []);

  const selectHomeSendcloudPlan = useCallback((plan: CheckoutHomeMethodOption) => {
    persistHomeSpeed("standard");
    setHomeOutboundOptionCode(plan.optionCode);
    writeCheckoutSendcloudOutboundOption("home", toHomeCheckoutSendcloudOutboundOption(plan));
  }, [persistHomeSpeed]);

  const deliveryAddressKey = useMemo(() => {
    if (!deliveryAddress) return "";
    return `${deliveryAddress.lat},${deliveryAddress.lon},${deliveryAddress.label}`;
  }, [deliveryAddress]);

  const deliveryAddressKeyRef = useRef(deliveryAddressKey);
  deliveryAddressKeyRef.current = deliveryAddressKey;

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") refreshCheckoutLocalState();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [refreshCheckoutLocalState]);

  /** Devis Uber : dès qu’une adresse existe (tous onglets), pour affichage instantané en « Uber Direct ». */
  useEffect(() => {
    if (uberQuoteDebounceRef.current != null) {
      clearTimeout(uberQuoteDebounceRef.current);
      uberQuoteDebounceRef.current = null;
    }

    if (!deliveryAddressKey) {
      setUberQuote(null);
      setUberQuoteError(null);
      setUberQuoteErrorCode(null);
      setUberQuoteErrorDetail(null);
      setUberQuoteFetch("idle");
      return;
    }

    setUberQuoteFetch("loading");
    setUberQuoteError(null);
    setUberQuoteErrorCode(null);
    setUberQuoteErrorDetail(null);

    const keyWhenScheduled = deliveryAddressKeyRef.current;

    uberQuoteDebounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const addr = readCheckoutDeliveryAddress();
          if (addr == null || deliveryAddressKeyRef.current !== keyWhenScheduled) return;

          const res = await fetch("/api/uber-direct/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deliveryAddress: addr }),
          });
          const j = (await res.json()) as {
            ok?: boolean;
            quote?: Record<string, unknown>;
            message?: string;
            detail?: string;
            code?: string;
          };
          if (deliveryAddressKeyRef.current !== keyWhenScheduled) return;

          if (!res.ok || !j.ok) {
            setUberQuote(null);
            setUberQuoteFetch("error");
            setUberQuoteError(
              typeof j.message === "string" && j.message.trim()
                ? j.message.trim()
                : `Erreur ${res.status}`,
            );
            setUberQuoteErrorCode(typeof j.code === "string" && j.code.trim() ? j.code.trim() : null);
            setUberQuoteErrorDetail(typeof j.detail === "string" && j.detail.trim() ? j.detail.trim() : null);
            return;
          }
          if (j.quote && typeof j.quote === "object") {
            setUberQuote(j.quote);
            setUberQuoteFetch("ok");
            setUberQuoteErrorCode(null);
            setUberQuoteErrorDetail(null);
          } else {
            setUberQuote(null);
            setUberQuoteFetch("error");
            setUberQuoteError("Réponse Uber inattendue.");
            setUberQuoteErrorCode(null);
            setUberQuoteErrorDetail(null);
          }
        } catch {
          if (deliveryAddressKeyRef.current !== keyWhenScheduled) return;
          setUberQuote(null);
          setUberQuoteFetch("error");
          setUberQuoteError("Connexion impossible pour le devis Uber.");
          setUberQuoteErrorCode(null);
          setUberQuoteErrorDetail(null);
        }
      })();
    }, 450);

    return () => {
      if (uberQuoteDebounceRef.current != null) {
        clearTimeout(uberQuoteDebounceRef.current);
        uberQuoteDebounceRef.current = null;
      }
    };
  }, [deliveryAddressKey]);

  const uberQuotePanelPhase: UberDirectQuotePhase = useMemo(() => {
    if (deliveryChannel !== "home") return "invite";
    if (homeSpeed !== "uber_direct") return "invite";
    if (deliveryAddress == null) return "need_address";
    if (uberQuoteFetch === "loading") return "loading";
    if (uberQuoteFetch === "error") return "error";
    if (uberQuoteFetch === "ok" && uberQuote) return "ok";
    return "loading";
  }, [deliveryAddress, deliveryChannel, homeSpeed, uberQuote, uberQuoteFetch]);

  /** L’offre Uber reste visible même sans devis, pour garder l’option express explicite. */
  const uberDeliveryOfferVisible = deliveryChannel === "home";

  useEffect(() => {
    if (deliveryChannel !== "home" || uberQuoteFetch !== "error") return;
    console.warn("[uber-direct/quote] devis indisponible au checkout", {
      message: uberQuoteError,
      code: uberQuoteErrorCode,
      detail: uberQuoteErrorDetail,
      deliveryAddress,
    });
  }, [deliveryAddress, deliveryChannel, uberQuoteError, uberQuoteErrorCode, uberQuoteErrorDetail, uberQuoteFetch]);

  const uberQuotePanelPhaseForPanel: UberDirectQuotePhase =
    deliveryChannel === "home" && uberQuoteFetch === "error"
      ? "error"
      : uberQuotePanelPhase;

  const showUberQuoteBelowCard =
    deliveryChannel === "home" &&
    (uberQuoteFetch === "error" ||
      (homeSpeed === "uber_direct" &&
        uberQuotePanelPhase !== "ok" &&
        uberQuotePanelPhase !== "invite"));

  /** Horloge de référence fixée quand le devis change, pour un libellé d’heure stable. */
  const uberArrivalKey =
    deliveryChannel === "home" &&
    homeSpeed === "uber_direct" &&
    uberQuoteFetch === "ok" &&
    uberQuote
      ? `${String(uberQuote.id ?? "")}|${String(uberQuote.duration ?? "")}`
      : "";
  const uberArrivalBaseTimeMs = useMemo(() => {
    void uberArrivalKey;
    return Date.now();
  }, [uberArrivalKey]);
  const uberArrivalLine = useMemo(
    () =>
      uberArrivalKey
        ? buildUberMemberArrivalLineFr(uberQuote, uberArrivalBaseTimeMs)
        : null,
    [uberArrivalKey, uberArrivalBaseTimeMs, uberQuote],
  );

  const itemCount = initialLines.length;
  const cartTotalMods = useMemo(
    () => initialLines.reduce((sum, line) => sum + line.pricePoints, 0),
    [initialLines],
  );
  const walletAppliedMods = Math.min(cartTotalMods, Math.max(0, availableWalletMods));

  const relayPostalNorm = relayPostal.replace(/\D/g, "").slice(0, 5);
  const selectionPostalNorm = (selectedRelay?.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
  /** Centrage carte relais Sendcloud : CP de l’adresse profil / checkout (pas de saisie manuelle). */
  const relayMapCenterPostalCode = useMemo(() => {
    const fromDelivery = extractPostalCodeFromAddress(deliveryAddress);
    if (fromDelivery.length === 5) return fromDelivery;
    if (defaultRelayPostalCode.length === 5) return defaultRelayPostalCode;
    return selectionPostalNorm.length === 5 ? selectionPostalNorm : "";
  }, [defaultRelayPostalCode, deliveryAddress, selectionPostalNorm]);
  const relayMapCenterPostalNorm = relayMapCenterPostalCode.replace(/\D/g, "").slice(0, 5);

  const shippingQuotePostalCode = useMemo(() => {
    const fromRelay =
      selectionPostalNorm.length === 5
        ? selectionPostalNorm
        : relayMapCenterPostalNorm.length === 5
          ? relayMapCenterPostalNorm
          : relayPostalNorm.length === 5
            ? relayPostalNorm
            : "";
    return memberPostalCodeForCheckoutShipping({
      deliveryChannel,
      relayPostalCode: fromRelay || defaultRelayPostalCode,
      deliveryAddress,
    });
  }, [
    defaultRelayPostalCode,
    deliveryAddress,
    deliveryChannel,
    relayMapCenterPostalNorm,
    relayPostalNorm,
    selectionPostalNorm,
  ]);

  const [relayOutboundOptionCode, setRelayOutboundOptionCode] = useState<string | null>(
    () => readCheckoutSendcloudOutboundOption("relay")?.optionCode ?? null,
  );
  const [homeOutboundOptionCode, setHomeOutboundOptionCode] = useState<string | null>(
    () => readCheckoutSendcloudOutboundOption("home")?.optionCode ?? null,
  );

  const sendcloudRelayCheckoutActive =
    sendcloudCheckoutConfigured && deliveryChannel === "relay";

  const relaySendcloudPricing = useCheckoutRelaySendcloudPricing({
    enabled: sendcloudRelayCheckoutActive && shippingQuotePostalCode.length === 5,
    itemCount,
    postalCode: shippingQuotePostalCode,
  });

  /** Retour relais (Shop2Shop) affiché sur domicile / Uber — même tarif DC que le relais. */
  const relayReturnQuoteForHome = useCheckoutRelaySendcloudPricing({
    enabled:
      sendcloudCheckoutConfigured &&
      deliveryChannel === "home" &&
      shippingQuotePostalCode.length === 5,
    itemCount,
    postalCode: shippingQuotePostalCode,
  });

  const homeSendcloudPricingEnabled =
    sendcloudCheckoutConfigured && deliveryChannel === "home" && shippingQuotePostalCode.length === 5;

  const homeSendcloudPricing = useCheckoutHomeSendcloudPricing({
    enabled: homeSendcloudPricingEnabled,
    itemCount,
    postalCode: shippingQuotePostalCode,
  });

  const homeSendcloudPlans = homeSendcloudPricing.methodOptions;

  const homeDeliveryOptionsPending =
    deliveryChannel === "home" &&
    (homeSendcloudPricing.loading ||
      (deliveryAddress != null && (uberQuoteFetch === "loading" || uberQuoteFetch === "idle")));

  const homeDeliveryOptionsVisible =
    uberDeliveryOfferVisible || homeSendcloudPlans.length > 0;

  const homeDeliveryOptionsLoadingMessage =
    homeDeliveryOptionsPending && !homeDeliveryOptionsVisible;

  const homeDeliveryNoCarriersAvailable =
    deliveryChannel === "home" &&
    !homeDeliveryOptionsPending &&
    !homeDeliveryOptionsVisible &&
    deliveryAddress != null;

  const selectedHomeSendcloudPlan = useMemo(() => {
    if (!homeOutboundOptionCode) return null;
    return homeSendcloudPlans.find((o) => o.optionCode === homeOutboundOptionCode) ?? null;
  }, [homeOutboundOptionCode, homeSendcloudPlans]);

  const homeSendcloudPlanSelected =
    homeSpeed === "standard" && selectedHomeSendcloudPlan != null;

  const selectedHomeMethodRoundTrip = useMemo(() => {
    const picked = selectedHomeSendcloudPlan;
    if (!picked) return null;
    return {
      outboundCents: picked.outboundHtCents,
      returnRelayCents: picked.returnHtCents,
      subtotalCents: picked.bundledRoundTripHtCents,
    };
  }, [selectedHomeSendcloudPlan]);

  const selectedOutboundOptionCode =
    deliveryChannel === "relay" ? relayOutboundOptionCode : homeOutboundOptionCode;

  useEffect(() => {
    if (deliveryChannel !== "relay" || !relaySendcloudPricing.pricing) return;
    const stored = toRelayCheckoutSendcloudOutboundOption(
      relaySendcloudPricing.pricing,
      selectedRelay?.sendcloudCarrier,
    );
    setRelayOutboundOptionCode(stored.optionCode);
    writeCheckoutSendcloudOutboundOption("relay", stored);
  }, [deliveryChannel, relaySendcloudPricing.pricing, selectedRelay?.sendcloudCarrier]);

  useEffect(() => {
    if (deliveryChannel !== "home" || homeSendcloudPricing.loading) return;
    if (homeSpeed !== "standard") return;
    if (homeSendcloudPlans.length > 0) return;
    setHomeOutboundOptionCode(null);
    writeCheckoutSendcloudOutboundOption("home", null);
    if (uberQuoteFetch !== "error") {
      persistHomeSpeed("uber_direct");
    }
  }, [
    deliveryChannel,
    homeSendcloudPlans.length,
    homeSendcloudPricing.loading,
    homeSpeed,
    persistHomeSpeed,
    uberQuoteFetch,
  ]);

  useEffect(() => {
    if (deliveryChannel !== "home" || uberQuoteFetch !== "error") return;
    if (homeSpeed !== "uber_direct") return;
    const first = homeSendcloudPlans[0];
    if (first) {
      selectHomeSendcloudPlan(first);
    } else {
      setHomeOutboundOptionCode(null);
      writeCheckoutSendcloudOutboundOption("home", null);
    }
  }, [deliveryChannel, homeSendcloudPlans, homeSpeed, selectHomeSendcloudPlan, uberQuoteFetch]);

  useEffect(() => {
    if (deliveryChannel !== "home" || homeSendcloudPricing.loading) return;
    if (homeOutboundOptionCode == null) return;
    if (homeSendcloudPlans.some((p) => p.optionCode === homeOutboundOptionCode)) return;
    setHomeOutboundOptionCode(null);
    writeCheckoutSendcloudOutboundOption("home", null);
    if (homeSpeed === "standard" && uberQuoteFetch !== "error") persistHomeSpeed("uber_direct");
  }, [
    deliveryChannel,
    homeOutboundOptionCode,
    homeSendcloudPlans,
    homeSendcloudPricing.loading,
    homeSpeed,
    persistHomeSpeed,
    uberQuoteFetch,
  ]);

  const sendcloudShippingQuote = useSendcloudCheckoutShippingQuote({
    itemCount,
    postalCode: shippingQuotePostalCode,
    relayOutboundOptionCode,
    homeOutboundOptionCode,
  });

  const relayRoundTrip = sendcloudShippingQuote.relayRoundTrip;
  const standardHomeRoundTrip = sendcloudShippingQuote.homeRoundTrip;

  const homeReturnHtCents = useMemo(() => {
    if (selectedHomeSendcloudPlan?.returnHtCents != null) {
      return selectedHomeSendcloudPlan.returnHtCents;
    }
    if (homeSendcloudPricing.returnHtCents != null) {
      return homeSendcloudPricing.returnHtCents;
    }
    return relayReturnQuoteForHome.pricing?.returnHtCents ?? null;
  }, [
    homeSendcloudPricing.returnHtCents,
    relayReturnQuoteForHome.pricing?.returnHtCents,
    selectedHomeSendcloudPlan?.returnHtCents,
  ]);

  const homeReturnTtcCents = useMemo(() => {
    if (selectedHomeSendcloudPlan?.returnTtcCents != null) {
      return selectedHomeSendcloudPlan.returnTtcCents;
    }
    if (homeSendcloudPricing.returnTtcCents != null) {
      return homeSendcloudPricing.returnTtcCents;
    }
    return relayReturnQuoteForHome.pricing?.returnTtcCents ?? null;
  }, [
    homeSendcloudPricing.returnTtcCents,
    relayReturnQuoteForHome.pricing?.returnTtcCents,
    selectedHomeSendcloudPlan?.returnTtcCents,
  ]);

  /** Aller domicile en Uber : centimes issus du devis API (aligné facturation Stripe). */
  const uberOutboundCentsFromQuote = useMemo(() => {
    if (deliveryChannel !== "home") return null;
    if (uberQuoteFetch !== "ok" || !uberQuote) return null;
    return uberQuoteFeeCentsFromRaw(uberQuote);
  }, [deliveryChannel, uberQuoteFetch, uberQuote]);

  const exchangeShipping = useMemo(() => {
    if (deliveryChannel === "relay") return relayRoundTrip;
    if (homeSendcloudPlanSelected && selectedHomeMethodRoundTrip) {
      return selectedHomeMethodRoundTrip;
    }
    if (
      deliveryChannel === "home" &&
      homeSpeed === "uber_direct" &&
      uberOutboundCentsFromQuote != null &&
      homeReturnHtCents != null
    ) {
      return {
        outboundCents: uberOutboundCentsFromQuote,
        returnRelayCents: homeReturnHtCents,
        subtotalCents: uberOutboundCentsFromQuote + homeReturnHtCents,
      };
    }
    return { outboundCents: 0, returnRelayCents: 0, subtotalCents: 0 };
  }, [
    deliveryChannel,
    homeReturnHtCents,
    homeSendcloudPlanSelected,
    homeSpeed,
    relayRoundTrip,
    selectedHomeMethodRoundTrip,
    uberOutboundCentsFromQuote,
  ]);
  const sendcloudPricingActive =
    sendcloudLivePricing && sendcloudShippingQuote.pricingSource === "sendcloud";
  const sendcloudQuoteLoading =
    sendcloudLivePricing &&
    shippingQuotePostalCode.length === 5 &&
    (deliveryChannel === "relay" && sendcloudRelayCheckoutActive
      ? relaySendcloudPricing.loading
      : deliveryChannel !== "home"
        ? sendcloudShippingQuote.loading
        : false);
  const sendcloudRelayUi = sendcloudSpp || sendcloudRelaySearch;

  const uberBillingReady =
    deliveryChannel !== "home" || homeSpeed !== "uber_direct" || uberOutboundCentsFromQuote != null;

  const selectedRelayCarrierRoundTrip = useMemo(() => {
    const p = relaySendcloudPricing.pricing;
    if (!p) return null;
    return {
      outboundCents: p.outboundHtCents,
      returnRelayCents: p.returnHtCents,
      subtotalCents: p.bundledRoundTripHtCents,
    };
  }, [relaySendcloudPricing.pricing]);

  const billedRoundTripSubtotalCents = useMemo(() => {
    const roundTripForBilling =
      deliveryChannel === "relay" && sendcloudRelayCheckoutActive
        ? selectedRelayCarrierRoundTrip
        : homeSendcloudPlanSelected
          ? selectedHomeMethodRoundTrip
          : selectedRelayCarrierRoundTrip ?? exchangeShipping;
    if (!roundTripForBilling) {
      return 0;
    }
    try {
      return computeCartCheckoutRoundTripShippingHtCents({
        itemCount,
        deliveryChannel,
        homeSpeedBilling: homeSpeed,
        includedKind: includedExchangeShipping,
        relayRoundTrip,
        currentRoundTrip: roundTripForBilling,
        uberOutboundHtCents: uberOutboundCentsFromQuote,
      });
    } catch {
      if (deliveryChannel === "home" && homeSpeed === "uber_direct") {
        return uberOutboundCentsFromQuote != null
          ? uberOutboundCentsFromQuote + exchangeShipping.returnRelayCents
          : exchangeShipping.subtotalCents;
      }
      return exchangeShipping.subtotalCents;
    }
  }, [
    deliveryChannel,
    exchangeShipping,
    homeSpeed,
    includedExchangeShipping,
    itemCount,
    relayRoundTrip,
    selectedRelayCarrierRoundTrip,
    homeSendcloudPlanSelected,
    selectedHomeMethodRoundTrip,
    sendcloudRelayCheckoutActive,
    uberOutboundCentsFromQuote,
  ]);

  const includedShippingQuotaLabel =
    includedExchangeShipping !== "none" && remainingIncludedOrdersThisMonth > 0
      ? formatIncludedShippingQuotaLabel(
          membershipLabel,
          subscriptionIncludedOrdersRemaining,
          includedOrdersLimitThisMonth,
        )
      : null;

  const creditsTtcCents = Math.round(exchangeCreditsChargeEuros * 100);

  const expressOptionShippingHtCents = useMemo(() => {
    try {
      return computeCartCheckoutRoundTripShippingHtCents({
        itemCount,
        deliveryChannel: "home",
        homeSpeedBilling: "uber_direct",
        includedKind: includedExchangeShipping,
        relayRoundTrip,
        currentRoundTrip: standardHomeRoundTrip,
        uberOutboundHtCents: uberOutboundCentsFromQuote,
      });
    } catch {
      return uberOutboundCentsFromQuote != null
        ? uberOutboundCentsFromQuote + standardHomeRoundTrip.returnRelayCents
        : standardHomeRoundTrip.subtotalCents;
    }
  }, [
    includedExchangeShipping,
    itemCount,
    relayRoundTrip,
    standardHomeRoundTrip,
    uberOutboundCentsFromQuote,
  ]);

  const relayInboundShowsZero = includedExchangeShipping !== "none";

  const relayHeaderPriceLoading =
    deliveryChannel === "relay" &&
    !relayInboundShowsZero &&
    (sendcloudRelayCheckoutActive ? relaySendcloudPricing.loading : sendcloudQuoteLoading);

  const homeDeliveryShowsFullIncluded = includedExchangeShipping === "member_all_modes";

  const shippingHtCents = useMemo(() => billedRoundTripSubtotalCents, [billedRoundTripSubtotalCents]);

  const waiveServiceFeeForIncludedExchange = includedExchangeShipping !== "none";

  const fullRoundTripHtCents = useMemo(() => {
    const roundTripForBilling =
      deliveryChannel === "relay" && sendcloudRelayCheckoutActive
        ? selectedRelayCarrierRoundTrip
        : homeSendcloudPlanSelected
          ? selectedHomeMethodRoundTrip
          : selectedRelayCarrierRoundTrip ?? exchangeShipping;
    if (!roundTripForBilling) return 0;
    try {
      return computeCartCheckoutRoundTripShippingHtCents({
        itemCount,
        deliveryChannel,
        homeSpeedBilling: homeSpeed,
        includedKind: "none",
        relayRoundTrip,
        currentRoundTrip: roundTripForBilling,
        uberOutboundHtCents: uberOutboundCentsFromQuote,
      });
    } catch {
      if (deliveryChannel === "home" && homeSpeed === "uber_direct") {
        return uberOutboundCentsFromQuote != null
          ? uberOutboundCentsFromQuote + exchangeShipping.returnRelayCents
          : exchangeShipping.subtotalCents;
      }
      return exchangeShipping.subtotalCents;
    }
  }, [
    deliveryChannel,
    exchangeShipping,
    homeSpeed,
    itemCount,
    relayRoundTrip,
    selectedRelayCarrierRoundTrip,
    homeSendcloudPlanSelected,
    selectedHomeMethodRoundTrip,
    sendcloudRelayCheckoutActive,
    uberOutboundCentsFromQuote,
  ]);

  const feesPricing = useMemo(
    () =>
      computeCartCheckoutNetFees({
        billedShippingHtCents: shippingHtCents,
        creditsTtcCents,
        waiveServiceFeeForIncludedExchange,
      }),
    [creditsTtcCents, shippingHtCents, waiveServiceFeeForIncludedExchange],
  );

  const grossFeesPricing = useMemo(
    () => computeCartCheckoutFeesWithServiceRoundUp(fullRoundTripHtCents, creditsTtcCents),
    [creditsTtcCents, fullRoundTripHtCents],
  );

  const includedFeeReductions = useMemo(
    () => computeCartCheckoutIncludedFeeReductions(grossFeesPricing, feesPricing),
    [feesPricing, grossFeesPricing],
  );

  const showIncludedFeeReductionLines = includedFeeReductions.totalTtcCents > 0;

  const feesHtEuros = centsToEuros(feesPricing.feesHtCents);
  const feesVatEuros = centsToEuros(feesPricing.feesVatCents);
  const feesTtcEuros = centsToEuros(feesPricing.feesTtcCents);
  const serviceTtcEuros = centsToEuros(
    showIncludedFeeReductionLines ? grossFeesPricing.serviceTtcCents : feesPricing.serviceTtcCents,
  );
  const shippingTtcEuros = centsToEuros(
    showIncludedFeeReductionLines ? grossFeesPricing.shippingTtcCents : feesPricing.shippingTtcCents,
  );
  const includedServiceReductionEuros = centsToEuros(includedFeeReductions.serviceTtcCents);
  const includedShippingReductionEuros = centsToEuros(includedFeeReductions.shippingTtcCents);

  const shippingFeesSplit = useMemo((): { outboundEuros: number; returnEuros: number } | null => {
    if (relayInboundShowsZero || homeDeliveryShowsFullIncluded) return null;

    if (deliveryChannel === "relay" && sendcloudRelayCheckoutActive && relaySendcloudPricing.pricing) {
      return {
        outboundEuros: centsToEuros(relaySendcloudPricing.pricing.outboundTtcCents),
        returnEuros: centsToEuros(relaySendcloudPricing.pricing.returnTtcCents),
      };
    }

    if (deliveryChannel === "home" && homeSendcloudPlanSelected && selectedHomeSendcloudPlan) {
      return {
        outboundEuros: centsToEuros(selectedHomeSendcloudPlan.outboundTtcCents),
        returnEuros: centsToEuros(selectedHomeSendcloudPlan.returnTtcCents),
      };
    }

    if (
      deliveryChannel === "home" &&
      homeSpeed === "uber_direct" &&
      uberOutboundCentsFromQuote != null &&
      homeReturnTtcCents != null
    ) {
      return {
        outboundEuros: centsToEuros(htToVatAndTtcCents(uberOutboundCentsFromQuote).ttcCents),
        returnEuros: centsToEuros(homeReturnTtcCents),
      };
    }

    return null;
  }, [
    deliveryChannel,
    homeDeliveryShowsFullIncluded,
    homeReturnTtcCents,
    homeSendcloudPlanSelected,
    homeSpeed,
    relayInboundShowsZero,
    relaySendcloudPricing.pricing,
    selectedHomeSendcloudPlan,
    sendcloudRelayCheckoutActive,
    uberOutboundCentsFromQuote,
  ]);
  const relayHeaderShippingTtcEuros = useMemo(() => {
    if (deliveryChannel !== "relay" || relayInboundShowsZero) return shippingTtcEuros;
    if (sendcloudRelayCheckoutActive && relaySendcloudPricing.pricing) {
      return centsToEuros(relaySendcloudPricing.pricing.bundledRoundTripTtcCents);
    }
    return shippingTtcEuros;
  }, [
    deliveryChannel,
    relayInboundShowsZero,
    relaySendcloudPricing.pricing,
    sendcloudRelayCheckoutActive,
    shippingTtcEuros,
  ]);

  const expressOptionShippingTtcEuros = centsToEuros(
    computeCartCheckoutFeesWithServiceRoundUp(expressOptionShippingHtCents, creditsTtcCents)
      .shippingTtcCents,
  );
  const grandTotal = exchangeCreditsChargeEuros + feesTtcEuros;
  const complementMods = Math.max(0, cartTotalMods - walletAppliedMods);

  /** Liste MR : CP de recherche = CP du point choisi. Carte Sendcloud : sélection sur la carte suffit. */
  const relayPostalMatchesSelection = sendcloudSpp
    ? selectedRelay != null
    : selectedRelay != null &&
      relayPostalNorm.length === 5 &&
      relayPostalNorm === selectionPostalNorm;
  /**
   * Si une liste de résultats est affichée, le point choisi doit en faire partie (recherche actuelle).
   * Liste vide : OK si relais + CP déjà alignés (retour sur la page sans relancer la recherche).
   */
  const relayPickMatchesVisibleResults =
    relayPoints.length === 0
      ? true
      : selectedRelay != null && relayPoints.some((p) => p.code === selectedRelay.code);

  const carrierPickReady =
    deliveryChannel === "relay"
      ? !sendcloudRelayCheckoutActive || relaySendcloudPricing.pricing != null
      : homeSpeed === "uber_direct" || homeSendcloudPlanSelected;

  const outboundDeliveryReady =
    deliveryChannel === "relay"
      ? relayPostalMatchesSelection && relayPickMatchesVisibleResults && carrierPickReady
      : deliveryAddress != null && carrierPickReady;
  const deliveryReady = outboundDeliveryReady;

  const startStripeCheckout = useCallback(async () => {
    setStripeCheckoutError(null);
    if (!outboundDeliveryReady) {
      setStripeCheckoutError(
        deliveryChannel === "relay"
          ? "Choisis un point relais avant de payer."
          : "Renseigne une adresse de livraison avant de payer.",
      );
      return;
    }
    if (!rentalTermsAccepted) {
      setStripeCheckoutError("Tu dois confirmer avoir lu les conditions générales de location pour continuer.");
      return;
    }
    if (deliveryChannel === "home" && homeSpeed === "uber_direct" && uberOutboundCentsFromQuote == null) {
      setStripeCheckoutError(
        "Attends l’affichage du tarif Uber (ou corrige l’adresse) avant de payer.",
      );
      return;
    }
    if (!carrierPickReady) {
      setStripeCheckoutError(
        deliveryChannel === "home"
          ? "Choisis une option de livraison (Uber ou offre domicile disponible)."
          : "Choisis un transporteur pour l’expédition aller.",
      );
      return;
    }
    if (deliveryChannel === "home" && homeSpeed === "standard" && !homeSendcloudPlanSelected) {
      setStripeCheckoutError("Choisis une offre de livraison à domicile.");
      return;
    }
    const sendcloudOutboundSelection =
      deliveryChannel === "relay" && sendcloudRelayCheckoutActive
        ? readCheckoutSendcloudOutboundOption("relay")
        : deliveryChannel === "home" && homeSendcloudPlanSelected
          ? readCheckoutSendcloudOutboundOption("home")
          : null;
    setStripeCheckoutBusy(true);
    try {
      const res = await fetch("/api/stripe/cart/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryChannel,
          homeSpeed,
          relaySelection: deliveryChannel === "relay" ? selectedRelay : undefined,
          deliveryAddress: deliveryChannel === "home" ? deliveryAddress : undefined,
          deliveryInstructions: deliveryChannel === "home" ? instructionsSaved.trim() : undefined,
          sendcloudOutboundSelection: sendcloudOutboundSelection ?? undefined,
          acceptRentalTerms: true,
          borrowDurationDays:
            missingExchangeMods > 0
              ? borrowDurationDays
              : defaultCheckoutBorrowDurationDays(borrowCheckoutOptions),
        }),
      });
      const j = (await res.json()) as { url?: string; message?: string };
      if (!res.ok) {
        setStripeCheckoutError(j.message ?? "Paiement impossible.");
        return;
      }
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      setStripeCheckoutError("Réponse Stripe inattendue.");
    } catch {
      setStripeCheckoutError("Connexion impossible. Réessaie.");
    } finally {
      setStripeCheckoutBusy(false);
    }
  }, [
    deliveryAddress,
    deliveryChannel,
    outboundDeliveryReady,
    homeSpeed,
    instructionsSaved,
    rentalTermsAccepted,
    carrierPickReady,
    deliveryChannel,
    selectedRelay,
    homeSendcloudPlanSelected,
    selectedOutboundOptionCode,
    sendcloudRelayCheckoutActive,
    uberOutboundCentsFromQuote,
    borrowDurationDays,
    missingExchangeMods,
    borrowCheckoutOptions,
  ]);

  const searchRelayPoints = useCallback(async () => {
    const pc = relayPostal.replace(/\D/g, "").slice(0, 5);
    if (pc.length !== 5) {
      setRelaySearchError("Saisis un code postal à 5 chiffres.");
      setRelayPoints([]);
      return;
    }
    setRelayLoading(true);
    setRelaySearchError(null);
    try {
      const searchUrl = sendcloudRelaySearch
        ? "/api/items/sendcloud/relay-search"
        : "/api/items/mondial-relay/relay-search";
      const searchBody = sendcloudRelaySearch
        ? { postal_code: pc, country: "FR" }
        : {
            postal_code: pc,
            country: "FR",
            weight_g: RELAY_SEARCH_WEIGHT_G,
            action: "24R",
            purpose: "cart_outbound",
          };
      const res = await fetch(searchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchBody),
      });
      const j = (await res.json()) as {
        points?: Array<{
          code: string;
          label: string;
          postalCode?: string;
          city?: string;
          sendcloudServicePointId?: number;
          sendcloudCode?: string;
        }>;
        error?: string;
        hint?: string;
        plan_tri?: {
          applied?: boolean;
          excluded_count?: number;
          excluded_samples?: { code: string; statut: string }[];
          excluded_stat_histogram?: Record<string, number>;
          skipped_reason?: string;
          destination_postcode?: string;
          search_postcodes?: string[];
          wsi3_total_before_plan_tri?: number;
        };
        /** Présent quand tous les relais WSI3 sont exclus avec le statut MR 97 (diagnostic sans secrets). */
        plan_tri_diagnostics?: Record<string, unknown>;
        diagnostics?: {
          mondial_relay_soap?: { missing?: string[] };
          deployment?: { vercel_env?: string | null; vercel_url?: string | null };
        };
      };
      if (!res.ok) {
        if (j.diagnostics?.mondial_relay_soap?.missing?.length) {
          console.warn("[relay-search] Variables manquantes côté serveur:", j.diagnostics.mondial_relay_soap.missing, j.diagnostics);
        }
        setRelaySearchError(userFacingRelaySearchError(res.status, j.error));
        setRelayPoints([]);
        setSelectedRelay(null);
        writeCheckoutRelaySelection(null);
        return;
      }
      const raw = Array.isArray(j.points) ? j.points : [];
      const list: CheckoutRelaySelection[] = raw.map((p) => ({
        code: p.code,
        label: p.label,
        postalCode: p.postalCode ?? pc,
        city: p.city,
        sendcloudServicePointId:
          typeof p.sendcloudServicePointId === "number" && p.sendcloudServicePointId > 0
            ? p.sendcloudServicePointId
            : undefined,
        sendcloudCarrier: undefined,
      }));
      setRelayPoints(list);
      if (list.length === 0) {
        const hubCp = j.plan_tri?.destination_postcode?.trim();
        const searched = j.plan_tri?.search_postcodes?.join(", ");
        const extra =
          searched && hubCp
            ? ` (zones testées : ${searched}, hub ${hubCp})`
            : hubCp
              ? ` (hub Segna : ${hubCp})`
              : "";
        setRelaySearchError((j.hint ?? "Aucun point relais compatible pour ce secteur.") + extra);
        setSelectedRelay(null);
        writeCheckoutRelaySelection(null);
        if (j.plan_tri || j.plan_tri_diagnostics) {
          console.warn("[relay-search] diagnostic plan_tri (réponse API)", {
            plan_tri: j.plan_tri,
            plan_tri_diagnostics: j.plan_tri_diagnostics,
          });
        }
      } else {
        setSelectedRelay((cur) => {
          if (cur && list.some((x) => x.code === cur.code)) return cur;
          writeCheckoutRelaySelection(null);
          return null;
        });
      }
    } catch {
      setRelaySearchError("Recherche impossible. Réessaie dans un instant.");
      setRelayPoints([]);
      setSelectedRelay(null);
      writeCheckoutRelaySelection(null);
    } finally {
      setRelayLoading(false);
    }
  }, [relayPostal, sendcloudRelaySearch]);

  const onSelectRelay = useCallback(
    (r: CheckoutRelaySelection) => {
      setSelectedRelay(r);
      writeCheckoutRelaySelection(r);
      if (sendcloudRelayCheckoutActive && relaySendcloudPricing.pricing) {
        const stored = toRelayCheckoutSendcloudOutboundOption(
          relaySendcloudPricing.pricing,
          r.sendcloudCarrier,
        );
        setRelayOutboundOptionCode(stored.optionCode);
        writeCheckoutSendcloudOutboundOption("relay", stored);
      }
      setRelayPoints((prev) => {
        if (prev.length === 0) return prev;
        const others = prev.filter((x) => x.code !== r.code);
        return [r, ...others];
      });
      window.setTimeout(() => {
        relayListScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }, 0);
    },
    [relaySendcloudPricing.pricing, sendcloudRelayCheckoutActive],
  );

  useEffect(() => {
    if (!instructionsOpen) return;
    setInstructionsDraft(readCheckoutDeliveryInstructions());
  }, [instructionsOpen]);

  useEffect(() => {
    if (hideReservationTimer) {
      setRemainingMs(TIMER_MS);
      return;
    }
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(CART_RESERVED_AT_STORAGE_KEY) : null;
    let start: number;
    if (raw == null || raw === "") {
      start = Date.now();
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(CART_RESERVED_AT_STORAGE_KEY, String(start));
      }
    } else {
      const parsed = Number(raw);
      start = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
      if (!Number.isFinite(parsed) || parsed <= 0) {
        window.sessionStorage.setItem(CART_RESERVED_AT_STORAGE_KEY, String(start));
      }
    }
    const deadline = start + TIMER_MS;
    const tick = () => {
      setRemainingMs(Math.max(0, deadline - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [hideReservationTimer]);

  const onBack = useCallback(() => {
    router.push("/cart");
  }, [router]);

  /** Moins d’une minute restante : chiffres rouges (y compris 0:00). */
  const timerLastMinute = remainingMs < 60_000;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white">
      {/* Header — même logique que le panier : flèche + timer, titre Playfair en dessous, sans trait de séparation */}
      <header className="fixed left-1/2 top-0 z-30 w-full max-w-[430px] -translate-x-1/2 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBack}
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label="Retour"
            >
              <ChevronLeft className="h-8 w-8" strokeWidth={2.25} aria-hidden />
            </button>
            {hideReservationTimer ? (
              <div className="h-12 w-12 shrink-0" aria-hidden />
            ) : (
              <div
                className={cn(
                  "flex min-h-12 shrink-0 items-center justify-end font-mono text-[17px] font-semibold tabular-nums leading-none tracking-tight",
                  timerLastMinute ? "text-red-600" : "text-zinc-900",
                )}
                title="Temps restant pour finaliser"
              >
                {formatMmSs(remainingMs)}
              </div>
            )}
          </div>
          <h1 className={cn("mt-5 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Paiement</h1>
        </div>
      </header>

      {/* Réserve la hauteur du header fixe (aligné panier, sans sous-titre → un peu moins haut) */}
      <div
        className="mx-auto h-[calc(env(safe-area-inset-top,0px)+9rem)] w-full max-w-[430px] shrink-0 bg-white"
        aria-hidden
      />

      {/* Une colonne blanche, séparations fines type lignes d’items */}
      <div className="mx-auto w-full max-w-[430px] flex-1 bg-white pb-[calc(10.5rem+env(safe-area-inset-bottom,0px))]">
        {postStripeSyncError ? (
          <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-[13px] leading-snug text-red-950">
            <p className="font-semibold">Le paiement a réussi, mais la commande n’a pas été finalisée.</p>
            <p className="mt-1 text-red-900/90">
              Code : <span className="font-mono">{postStripeSyncError.reason}</span>
            </p>
            {postStripeSyncError.detail ? (
              <p className="mt-2 break-words font-mono text-[11px] text-red-800">{postStripeSyncError.detail}</p>
            ) : null}
            <p className="mt-2 text-[12px] text-red-800/90">
              Réessaie dans quelques secondes ou contacte le support avec l’ID de session Stripe. Si tu es en local,
              vérifie que les migrations SQL (wallet_debit + confirm_cart) sont bien appliquées sur ta base.
            </p>
          </div>
        ) : null}
        <div className="divide-y divide-zinc-200">
        {/* Switch Point relais / Domicile */}
        <section className="px-5 py-4">
          <div className="flex rounded-full bg-zinc-100 p-1 ring-1 ring-zinc-200/80">
            <button
              type="button"
              onClick={() => persistDeliveryChannel("relay")}
              className={cn(
                "min-h-[40px] flex-1 rounded-full px-2 py-2 text-center text-[14px] font-semibold transition",
                deliveryChannel === "relay" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600",
              )}
            >
              Point relais
            </button>
            <button
              type="button"
              onClick={() => persistDeliveryChannel("home")}
              className={cn(
                "min-h-[40px] flex-1 rounded-full px-2 py-2 text-center text-[14px] font-semibold transition",
                deliveryChannel === "home" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600",
              )}
            >
              Domicile
            </button>
          </div>
        </section>

        {deliveryChannel === "relay" ? (
          <>
            <section className="px-5 py-4">
              <h2 className={cn("min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
                Point relais
              </h2>
              {includedExchangeShipping !== "none" && includedShippingForfaitLine ? (
                <p className="mt-1 text-[14px] font-bold leading-snug text-zinc-900">{includedShippingForfaitLine}</p>
              ) : null}
              <div className="mb-4 mt-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Store className="mt-0.5 h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-zinc-900">Livraison point relais</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">
                      Choisis ton point relais sur la carte (Chronopost ou Mondial Relay).
                    </p>
                  </div>
                </div>
                <span className="shrink-0 pt-0.5 text-right text-[15px] font-semibold tabular-nums text-zinc-900">
                  {relayInboundShowsZero ? (
                    includedShippingQuotaLabel ? (
                      <span className="tabular-nums">{includedShippingQuotaLabel}</span>
                    ) : (
                      <span className="text-emerald-700">Offert</span>
                    )
                  ) : relayHeaderPriceLoading ? (
                    <span className="text-[13px] font-medium text-zinc-500">…</span>
                  ) : (
                    <>
                      {euros(relayHeaderShippingTtcEuros)}
                      <span className="ml-1 text-[11px] font-semibold text-zinc-500">TTC</span>
                    </>
                  )}
                </span>
              </div>
              {sendcloudRelayCheckoutActive && relaySendcloudPricing.error ? (
                <p className="mb-3 text-[13px] text-red-700">{relaySendcloudPricing.error}</p>
              ) : null}
              {!sendcloudStatusLoaded ? (
                <div className="mt-4 h-12 animate-pulse rounded-xl bg-zinc-100" aria-hidden />
              ) : sendcloudSpp ? (
                <div className="mt-4 space-y-3">
                  {(!sendcloudRelayCheckoutActive || relaySendcloudPricing.pricing) &&
                  !relaySendcloudPricing.loading ? (
                    <>
                      <SendcloudServicePointPicker
                        postalCode={relayMapCenterPostalCode}
                        onSelect={(r) => onSelectRelay(r)}
                      />
                      {selectedRelay ? (
                        <div className="rounded-xl border-2 border-zinc-900 bg-zinc-50 px-3 py-3 text-left">
                          <p className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                            Point relais sélectionné
                          </p>
                          <p className="mt-1 text-[14px] font-medium leading-snug text-zinc-900">
                            {formatCheckoutRelayDisplayLabel(selectedRelay.label)}
                          </p>
                          <p className="mt-0.5 text-[13px] text-zinc-600">
                            {[selectedRelay.postalCode, selectedRelay.city].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-[13px] text-zinc-500">
                      {relaySendcloudPricing.loading
                        ? "Calcul du tarif relais…"
                        : "Tarif relais indisponible — vérifie la méthode Sendcloud « Livraison en Relais »."}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <label className="block">
                    <span className="text-[13px] font-medium text-zinc-600">Code postal</span>
                    <p className="mt-1 text-[12px] leading-snug text-zinc-500">
                      {sendcloudRelaySearch
                        ? "Recherche les points relais proches de chez toi."
                        : "Recherche les points relais compatibles avec l’expédition Segna."}
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        value={relayPostal}
                        onChange={(e) => setRelayPostal(e.target.value.replace(/\D/g, "").slice(0, 5))}
                        placeholder="ex. 75017"
                        className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2.5 text-[16px] outline-none focus:border-zinc-900"
                      />
                      <button
                        type="button"
                        onClick={() => void searchRelayPoints()}
                        disabled={relayLoading}
                        className="shrink-0 rounded-xl bg-zinc-950 px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-60"
                      >
                        {relayLoading ? "…" : "Rechercher"}
                      </button>
                    </div>
                  </label>
                  {relaySearchError ? <p className="mt-2 text-[13px] text-red-600">{relaySearchError}</p> : null}
                  {relayPoints.length > 0 ? (
                    <ul
                      ref={relayListScrollRef}
                      className="mt-3 max-h-[240px] space-y-2 overflow-y-auto pr-0.5"
                    >
                      {relayPoints.map((r) => {
                        const isSelected = selectedRelay?.code === r.code;
                        return (
                          <li key={r.code}>
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => onSelectRelay(r)}
                              className={cn(
                                "w-full rounded-xl border-2 bg-white px-3 py-3 text-left transition",
                                isSelected ? "border-zinc-950" : "border-zinc-200",
                              )}
                            >
                              <p className="text-[15px] font-semibold text-zinc-900">
                                {formatCheckoutRelayDisplayLabel(r.label)}
                              </p>
                              <p className="text-[13px] text-zinc-600">
                                {[r.postalCode, r.city].filter(Boolean).join(" · ")}
                              </p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="px-5 py-3">
              <Link
                href="/cart/payment/address"
                className="flex w-full items-center gap-3 rounded-lg py-2 text-left active:opacity-90"
              >
                <Briefcase className="h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-zinc-500">Adresse de livraison</p>
                  <p className="text-[15px] font-medium text-zinc-900">
                    {deliveryAddress?.label ?? "Choisir une adresse"}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />
              </Link>
            </section>
            <section className="px-5 py-2">
              <button
                type="button"
                onClick={() => setInstructionsOpen(true)}
                className="flex w-full items-center gap-3 rounded-lg py-2 text-left active:opacity-90"
              >
                <User className="h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[15px] font-medium text-zinc-900">Rendez-vous devant ma porte</p>
                  <p className="text-[13px] text-emerald-700">
                    {instructionsSaved.trim() ? "Modifier les instructions" : "Ajouter des instructions de livraison"}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />
              </button>
            </section>
            <section className="px-5 py-4">
              <h2 className={cn("min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
                Livraison à Domicile
              </h2>
              {includedExchangeShipping !== "none" && includedShippingForfaitLine ? (
                <p className="mt-1 text-[14px] font-bold leading-snug text-zinc-900">{includedShippingForfaitLine}</p>
              ) : null}
              <div className="mt-3 grid gap-2">
                {homeDeliveryOptionsLoadingMessage ? (
                  <p className="text-[13px] text-zinc-500">Chargement des options…</p>
                ) : null}
                {homeDeliveryNoCarriersAvailable ? (
                  <p className="text-[13px] text-zinc-500">Aucun transporteur disponible</p>
                ) : null}
                {uberDeliveryOfferVisible ? (
                <div
                  className={cn(
                    "rounded-xl border transition",
                    homeSpeed === "uber_direct" ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => persistHomeSpeed("uber_direct")}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left"
                  >
                    <UberWordmarkIcon className="mt-0.5 h-5 w-5 shrink-0 text-zinc-900" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-semibold leading-tight text-zinc-900">
                          Aller express - Retour relais
                        </p>
                        <span className="shrink-0 text-right text-[14px] font-semibold tabular-nums text-zinc-900">
                          {uberQuoteFetch === "error" ? (
                            <span className="text-[13px] font-semibold text-zinc-500">
                              {uberDirectUnavailablePriceLabel(uberQuoteErrorCode)}
                            </span>
                          ) : homeDeliveryShowsFullIncluded ? (
                            includedShippingQuotaLabel ? (
                              <span className="tabular-nums">{includedShippingQuotaLabel}</span>
                            ) : (
                              <span className="text-emerald-700">Offert</span>
                            )
                          ) : uberQuoteFetch === "loading" || uberQuoteFetch === "idle" ? (
                            <span className="text-[13px] font-medium text-zinc-500">…</span>
                          ) : uberQuoteFetch === "ok" && uberQuote ? (
                            <>
                              {euros(expressOptionShippingTtcEuros)}
                              <span className="ml-1 text-[11px] font-semibold text-zinc-500">TTC</span>
                            </>
                          ) : (
                            <span className="text-[13px] font-medium text-zinc-500">…</span>
                          )}
                        </span>
                      </div>
                      {uberArrivalLine ? (
                        <p className="mt-0.5 text-[13px] text-zinc-500">{uberArrivalLine}</p>
                      ) : null}
                    </div>
                  </button>
                  {showUberQuoteBelowCard ? (
                    <div className="px-3 pb-3 pl-[calc(1.25rem+0.75rem)]">
                      <UberDirectQuotePanel
                        phase={uberQuotePanelPhaseForPanel}
                        errorMessage={uberQuoteError}
                        errorCode={uberQuoteErrorCode}
                      />
                    </div>
                  ) : null}
                </div>
                ) : null}
                {homeSendcloudPlans.map((plan) => {
                  const planSelected =
                    homeSpeed === "standard" && homeOutboundOptionCode === plan.optionCode;
                  const planShippingTtcEuros = centsToEuros(
                    computeCartCheckoutFeesWithServiceRoundUp(plan.bundledRoundTripHtCents, creditsTtcCents)
                      .shippingTtcCents,
                  );
                  return (
                    <button
                      key={plan.optionCode}
                      type="button"
                      onClick={() => selectHomeSendcloudPlan(plan)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition",
                        planSelected ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
                      )}
                    >
                      <CheckoutHomePlanCarrierIcon plan={plan} className="mt-0.5" />
                      <div className="min-w-0 flex-1 pr-1">
                        <p className="text-[15px] font-semibold leading-tight text-zinc-900">{plan.title}</p>
                        <p className="mt-0.5 text-[13px] text-zinc-500">
                          {checkoutHomePlanEtaSubtitle(plan)}
                        </p>
                      </div>
                      <span className="shrink-0 self-start pt-0.5 text-right text-[14px] font-semibold tabular-nums text-zinc-900">
                        {homeDeliveryShowsFullIncluded ? (
                          includedShippingQuotaLabel ? (
                            <span className="tabular-nums">{includedShippingQuotaLabel}</span>
                          ) : (
                            <span className="text-emerald-700">Offert</span>
                          )
                        ) : (
                          <>
                            {euros(planShippingTtcEuros)}
                            <span className="ml-1 text-[11px] font-semibold text-zinc-500">TTC</span>
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {homeSendcloudPlanSelected || homeSpeed === "uber_direct" ? (
                <p className="mt-2 text-[12px] leading-snug text-zinc-500">
                  Le retour se fait via dépôt en point relais Chronopost/Mondial Relay.
                </p>
              ) : null}
            </section>
          </>
        )}

        {/* Panier — même grille que le détail commande */}
        <section className="px-5 pb-4 pt-2">
          <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Panier</h2>
          {initialLines.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucun article.</p>
          ) : (
            <CommandeOrderLineRows
              lines={initialLines}
              creditKind={walletCreditKind}
              itemHrefSuffix="?from=cart"
              pointsUnitDisplay="icon"
            />
          )}
          <div className="mt-4 flex items-center justify-between gap-3 pt-2">
            <span className="text-[16px] font-bold text-zinc-900">Total échangé</span>
            <SegnaPointsUnitDisplay
              points={cartTotalMods}
              creditKind={walletCreditKind}
              unitDisplay="icon"
              numberClassName="text-[17px] font-bold text-zinc-900"
            />
          </div>
          {complementMods > 0 ? (
            <div className="mt-3 space-y-2.5 text-[15px] leading-snug">
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Complément d&apos;échange</span>
                <span className="inline-flex shrink-0 items-baseline gap-1.5 font-medium text-zinc-900">
                  <span className="tabular-nums">{borrowDurationDays}j&nbsp;×</span>
                  <SegnaPointsUnitDisplay
                    points={complementMods}
                    creditKind={walletCreditKind}
                    unitDisplay="icon"
                    numberClassName="font-medium text-zinc-900"
                  />
                </span>
              </div>
            </div>
          ) : null}
        </section>

        {/* Frais — aligné page commande */}
        <section className="px-5 py-4">
          <h2
            className={cn(
              "mb-4 flex min-w-0 items-center gap-2",
              segnaPlayfairDisplay.className,
              SEGNA_SECTION_TITLE_CLASSNAME,
            )}
          >
            <span className="min-w-0">Frais facturés</span>
            <button
              type="button"
              onClick={() => setFeesModalOpen(true)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[11px] font-semibold text-zinc-500"
              aria-label="Détail des frais"
            >
              i
            </button>
          </h2>
          <div className="space-y-2.5 text-[15px] leading-snug">
            <div className="flex items-baseline justify-between gap-3 text-zinc-700">
              <span className="min-w-0 pr-2">Complément d&apos;échange (TTC)</span>
              <span className="shrink-0 tabular-nums font-medium text-zinc-900">{euros(exchangeCreditsChargeEuros)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-zinc-700">
              <span className="min-w-0 pr-2">Frais de service (TTC)</span>
              <span className="shrink-0 font-medium tabular-nums text-zinc-900">{euros(serviceTtcEuros)}</span>
            </div>
            {showIncludedFeeReductionLines && includedServiceReductionEuros > 0 ? (
              <IncludedExchangeFeeReductionLine
                label="1er échange inclus"
                amountEuros={includedServiceReductionEuros}
              />
            ) : null}
            {shippingFeesSplit && !showIncludedFeeReductionLines ? (
              <>
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">Frais aller (TTC)</span>
                  <span className="shrink-0 font-medium tabular-nums text-zinc-900">
                    {euros(shippingFeesSplit.outboundEuros)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                  <span className="min-w-0 pr-2">Frais de retour (TTC)</span>
                  <span className="shrink-0 font-medium tabular-nums text-zinc-900">
                    {euros(shippingFeesSplit.returnEuros)}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">Frais de livraison (TTC)</span>
                <span className="shrink-0 font-medium tabular-nums text-zinc-900">{euros(shippingTtcEuros)}</span>
              </div>
            )}
            {showIncludedFeeReductionLines && includedShippingReductionEuros > 0 ? (
              <IncludedExchangeFeeReductionLine
                label="1er échange inclus"
                amountEuros={includedShippingReductionEuros}
              />
            ) : null}
            {feesVatEuros > 0 ? (
              <div className="flex items-baseline justify-between gap-3 text-zinc-700">
                <span className="min-w-0 pr-2">dont TVA (frais)</span>
                <span className="shrink-0 font-medium tabular-nums text-zinc-900">{euros(feesVatEuros)}</span>
              </div>
            ) : null}
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-4">
              <span className="text-[17px] font-bold text-zinc-900">Total à payer</span>
              <span className="text-[18px] font-bold tabular-nums text-zinc-900">{euros(grandTotal)}</span>
            </div>
          </div>
        </section>
        </div>
      </div>

      {/* Dock CTA + CGV */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto max-w-[430px] space-y-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-normal leading-snug text-zinc-600">
                Je confirme avoir pris connaissance des{" "}
                <a
                  href="/ressources/conditions-generales-location.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-zinc-800 underline underline-offset-2"
                >
                  conditions générales de location
                </a>{" "}
                de Segna.
              </p>
            </div>
            <label className="relative mt-0.5 inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center self-start">
              <input
                type="checkbox"
                checked={rentalTermsAccepted}
                onChange={(e) => {
                  setRentalTermsAccepted(e.target.checked);
                  if (e.target.checked) setStripeCheckoutError(null);
                }}
                className="peer sr-only"
                aria-label="Je confirme avoir pris connaissance des conditions générales de location"
              />
              <span
                className={cn(
                  "pointer-events-none flex size-[18px] items-center justify-center rounded-sm border border-zinc-900 bg-white peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-400 peer-focus-visible:ring-offset-2",
                  rentalTermsAccepted && "border-zinc-900 bg-zinc-900",
                )}
                aria-hidden
              >
                {rentalTermsAccepted ? <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden /> : null}
              </span>
            </label>
          </div>
          {stripeCheckoutError ? (
            <p className="text-center text-[13px] font-medium leading-snug text-red-600">{stripeCheckoutError}</p>
          ) : null}
          <button
            type="button"
            disabled={
              stripeCheckoutBusy ||
              !deliveryReady ||
              !rentalTermsAccepted ||
              !uberBillingReady ||
              sendcloudQuoteLoading
            }
            onClick={() => void startStripeCheckout()}
            className="flex h-[52px] w-full items-center justify-center rounded-xl bg-zinc-950 text-[16px] font-bold text-white shadow-sm transition hover:bg-zinc-900 disabled:opacity-50"
          >
            {stripeCheckoutBusy ? "Redirection vers Stripe…" : "Commander et payer"}
          </button>
        </div>
      </div>

      {/* Modale frais */}
      {feesModalOpen ? (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={() => setFeesModalOpen(false)}>
          <div className={SEGNA_DIALOG_SHEET_CLASS} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />
            <h2 className={segnaDialogTitleClass()}>Ce que comprennent vos frais</h2>
            <div className="mt-6 space-y-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px] font-semibold text-zinc-900">Frais de service (TTC)</span>
                  <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{euros(serviceTtcEuros)}</span>
                </div>
                {showIncludedFeeReductionLines && includedServiceReductionEuros > 0 ? (
                  <IncludedExchangeFeeReductionLine
                    label="1er échange inclus"
                    amountEuros={includedServiceReductionEuros}
                    className="mt-1.5"
                  />
                ) : null}
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  Frais fixes pour le traitement et le suivi de ta commande (TVA 20 % incluse).
                </p>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="min-w-0 flex-1 pr-2 text-[15px] font-semibold leading-snug text-zinc-900">
                    {deliveryChannel === "home" && homeSpeed === "uber_direct"
                      ? "Aller express - Retour relais (TTC)"
                      : "Livraison (TTC)"}
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{euros(shippingTtcEuros)}</span>
                </div>
                {showIncludedFeeReductionLines && includedShippingReductionEuros > 0 ? (
                  <IncludedExchangeFeeReductionLine
                    label="1er échange inclus"
                    amountEuros={includedShippingReductionEuros}
                    className="mt-1.5"
                  />
                ) : null}
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  {sendcloudPricingActive
                    ? `Aller + retour en point relais (${itemCount} article${itemCount > 1 ? "s" : ""}) : tarifs transporteurs via Sendcloud (TTC). Le retour est toujours en point relais vers notre centre logistique.`
                    : deliveryChannel === "relay"
                      ? `Aller-retour point relais (${itemCount} article${itemCount > 1 ? "s" : ""}) : paliers poids par quantité, +1,00 € par article au-delà de 3 (base HT, TVA comprise dans le montant TTC).`
                      : deliveryChannel === "home"
                        ? homeSpeed === "uber_direct" && uberOutboundCentsFromQuote != null
                          ? `Prestation complète : enlèvement express à domicile (devis Uber) puis retour de tes articles via un point relais (${itemCount} article${itemCount > 1 ? "s" : ""}). Montant TTC (TVA 20 %).`
                          : `Aller domicile + retour relais selon le nombre d’articles (${itemCount}). Retour toujours en point relais. Montant TTC (TVA 20 %).`
                        : null}
                  {showIncludedFeeReductionLines ? (
                    <span className="mt-1 block text-emerald-800/90">
                      Livraison (tous modes) et frais de service pris en charge pour cet échange inclus
                      {remainingIncludedOrdersThisMonth > 0
                        ? ` (${remainingIncludedOrdersThisMonth} échange${remainingIncludedOrdersThisMonth > 1 ? "s" : ""} inclus restant${remainingIncludedOrdersThisMonth > 1 ? "s" : ""} avant paiement)`
                        : ""}
                      .
                    </span>
                  ) : null}
                </p>
                <p className="mt-2 border-t border-zinc-100 pt-2 text-[11px] leading-snug text-zinc-500">
                  Le détail par ligne (dont frais de livraison) est repris dans la section « Frais facturés » au-dessus.
                </p>
              </div>
              <div className="flex items-baseline justify-between border-t border-zinc-200 pt-3">
                <span className="text-[12px] font-medium text-zinc-500">Base HT (réf. facturation)</span>
                <span className="text-[12px] font-medium tabular-nums text-zinc-600">{euros(feesHtEuros)}</span>
              </div>
              <div className="flex items-baseline justify-between border-t border-zinc-100 pt-2">
                <span className="text-[15px] font-bold text-zinc-900">{CART_CHECKOUT_VAT_LABEL}</span>
                <span className="text-[15px] font-bold tabular-nums text-zinc-900">{euros(feesVatEuros)}</span>
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-[16px] font-bold text-zinc-900">Total frais TTC</span>
                <span className="text-[16px] font-bold tabular-nums text-zinc-900">{euros(feesTtcEuros)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFeesModalOpen(false)}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}

      {/* Instructions livraison */}
      {instructionsOpen ? (
        <div
          className="fixed inset-0 z-[58] flex flex-col justify-end bg-black/40"
          onClick={() => setInstructionsOpen(false)}
        >
          <div className={SEGNA_DIALOG_SHEET_CLASS} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />
            <h2 className={segnaDialogTitleClass()}>Instructions de livraison</h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>Interphone, digicode, étage…</p>
            <textarea
              value={instructionsDraft}
              onChange={(e) => setInstructionsDraft(e.target.value)}
              rows={5}
              className="mt-4 w-full resize-none rounded-xl border border-zinc-200 px-3 py-3 text-[15px] text-zinc-900 outline-none focus:border-zinc-400"
              placeholder="Ex. Sonner chez Dupont, 3ᵉ étage sans ascenseur"
            />
            <button
              type="button"
              onClick={() => {
                const t = instructionsDraft.trim();
                writeCheckoutDeliveryInstructions(t);
                setInstructionsSaved(t);
                setInstructionsOpen(false);
              }}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition hover:bg-zinc-900"
            >
              Enregistrer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IncludedExchangeFeeReductionLine({
  label,
  amountEuros,
  className,
}: {
  label: string;
  amountEuros: number;
  className?: string;
}) {
  if (amountEuros <= 0) return null;
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <span className="min-w-0 pr-2 text-[14px] font-medium leading-snug text-emerald-700">{label}</span>
      <span className="shrink-0 tabular-nums text-[14px] font-semibold text-emerald-700">−{euros(amountEuros)}</span>
    </div>
  );
}
