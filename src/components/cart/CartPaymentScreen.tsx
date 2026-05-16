"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Check, ChevronLeft, ChevronRight, Home, Store, User } from "lucide-react";

import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
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
import { CART_CHECKOUT_VAT_LABEL, computeCartFeesHtVatTtc } from "@/lib/cart/cart-checkout-vat";
import { cartPaymentServiceFeeHtCents } from "@/lib/cart/cart-payment-fees";
import {
  computeCartCheckoutRoundTripShippingHtCents,
} from "@/lib/billing/cart-checkout-shipping-ht-cents";
import type { IncludedExchangeShippingKind } from "@/lib/billing/included-exchange-shipping";
import { includedOrdersUsedThisMonth } from "@/lib/billing/membership-included-orders";
import { exitCartFlow } from "@/lib/cart/pre-cart-exit-path";
import { CART_RESERVED_AT_STORAGE_KEY } from "@/lib/cart/reservation-timer";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
import {
  centsToEuros,
  computeExchangeRoundTripShippingCents,
} from "@/lib/shipping/exchange-shipping-pricing";
import { buildUberMemberArrivalLineFr, uberQuoteFeeCentsFromRaw } from "@/lib/uber-direct/format-quote-for-display";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { UberDirectQuotePanel, uberDirectUnavailablePriceLabel, type UberDirectQuotePhase } from "@/components/cart/UberDirectQuotePanel";
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
   * € à régler pour les crédits d’échange au-delà du solde wallet.
   * Aligné sur la section « Échange » du panier : les crédits wallet couvrent la partie correspondante.
   */
  exchangeCreditsChargeEuros: number;
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
  /** Sous-titre bleu sous Mondial Relay (forfait SegnaX / Segna+). */
  includedShippingForfaitLine?: string;
  /** Retour Stripe `/api/stripe/cart/sync` en erreur (débit wallet ou confirmation panier). */
  postStripeSyncError?: { reason: string; detail?: string } | null;
  /** Adresse du profil, utilisée comme valeur par défaut tant que le checkout n'a pas sa propre adresse. */
  initialProfileDeliveryAddress?: CheckoutDeliveryAddress | null;
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
  exchangeCreditsChargeEuros,
  availableWalletMods,
  hideReservationTimer = false,
  includedExchangeShipping = "none",
  remainingIncludedOrdersThisMonth = 0,
  includedOrdersLimitThisMonth = 0,
  includedShippingForfaitLine,
  postStripeSyncError = null,
  initialProfileDeliveryAddress = null,
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
  const [uberQuote, setUberQuote] = useState<Record<string, unknown> | null>(null);
  const [uberQuoteFetch, setUberQuoteFetch] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [uberQuoteError, setUberQuoteError] = useState<string | null>(null);
  const [uberQuoteErrorCode, setUberQuoteErrorCode] = useState<string | null>(null);
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
      setUberQuoteFetch("idle");
      return;
    }

    setUberQuoteFetch("loading");
    setUberQuoteError(null);
    setUberQuoteErrorCode(null);

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
            return;
          }
          if (j.quote && typeof j.quote === "object") {
            setUberQuote(j.quote);
            setUberQuoteFetch("ok");
            setUberQuoteErrorCode(null);
          } else {
            setUberQuote(null);
            setUberQuoteFetch("error");
            setUberQuoteError("Réponse Uber inattendue.");
            setUberQuoteErrorCode(null);
          }
        } catch {
          if (deliveryAddressKeyRef.current !== keyWhenScheduled) return;
          setUberQuote(null);
          setUberQuoteFetch("error");
          setUberQuoteError("Connexion impossible pour le devis Uber.");
          setUberQuoteErrorCode(null);
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

  /** Hors zone / erreur devis : masquer le prix sur la ligne Uber dès que le devis échoue (même si l’option standard est sélectionnée). */
  const uberExpressShowsUnavailablePrice =
    deliveryChannel === "home" && uberQuoteFetch === "error";

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
  const exchangeShipping = useMemo(
    () =>
      computeExchangeRoundTripShippingCents(itemCount, deliveryChannel === "relay" ? "relay" : "home"),
    [itemCount, deliveryChannel],
  );
  const relayRoundTrip = useMemo(
    () => computeExchangeRoundTripShippingCents(itemCount, "relay"),
    [itemCount],
  );
  const standardHomeRoundTrip = useMemo(
    () => computeExchangeRoundTripShippingCents(itemCount, "home"),
    [itemCount],
  );
  /** Aller domicile en Uber : centimes issus du devis API (aligné facturation Stripe). */
  const uberOutboundCentsFromQuote = useMemo(() => {
    if (deliveryChannel !== "home") return null;
    if (uberQuoteFetch !== "ok" || !uberQuote) return null;
    return uberQuoteFeeCentsFromRaw(uberQuote);
  }, [deliveryChannel, uberQuoteFetch, uberQuote]);

  const uberBillingReady =
    deliveryChannel !== "home" || homeSpeed !== "uber_direct" || uberOutboundCentsFromQuote != null;

  const billedRoundTripSubtotalCents = useMemo(() => {
    try {
      return computeCartCheckoutRoundTripShippingHtCents({
        itemCount,
        deliveryChannel,
        homeSpeedBilling: homeSpeed,
        includedKind: includedExchangeShipping,
        relayRoundTrip,
        currentRoundTrip: exchangeShipping,
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
    uberOutboundCentsFromQuote,
  ]);

  const includedShippingQuotaLabel =
    includedExchangeShipping !== "none" && includedOrdersLimitThisMonth > 0
      ? `${includedOrdersUsedThisMonth(remainingIncludedOrdersThisMonth, includedOrdersLimitThisMonth)}/${includedOrdersLimitThisMonth}`
      : null;

  const serviceHtCents = cartPaymentServiceFeeHtCents(itemCount);

  const standardOptionShippingHtCents = useMemo(() => {
    try {
      return computeCartCheckoutRoundTripShippingHtCents({
        itemCount,
        deliveryChannel: "home",
        homeSpeedBilling: "standard",
        includedKind: includedExchangeShipping,
        relayRoundTrip,
        currentRoundTrip: standardHomeRoundTrip,
        uberOutboundHtCents: null,
      });
    } catch {
      return standardHomeRoundTrip.subtotalCents;
    }
  }, [includedExchangeShipping, itemCount, relayRoundTrip, standardHomeRoundTrip]);

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

  const relayInboundShowsZero =
    includedExchangeShipping === "member_all_modes" ||
    (includedExchangeShipping === "guest_relay_round_trip_equivalent" && deliveryChannel === "relay");

  const homeDeliveryShowsFullIncluded = includedExchangeShipping === "member_all_modes";

  const shippingHtCents = useMemo(() => billedRoundTripSubtotalCents, [billedRoundTripSubtotalCents]);

  const feesPricing = useMemo(
    () => computeCartFeesHtVatTtc(shippingHtCents, serviceHtCents),
    [shippingHtCents, serviceHtCents],
  );

  const feesHtEuros = centsToEuros(feesPricing.feesHtCents);
  const feesVatEuros = centsToEuros(feesPricing.feesVatCents);
  const feesTtcEuros = centsToEuros(feesPricing.feesTtcCents);
  const serviceTtcEuros = centsToEuros(feesPricing.serviceTtcCents);
  const shippingTtcEuros = centsToEuros(feesPricing.shippingTtcCents);
  const standardOptionShippingTtcEuros = centsToEuros(
    computeCartFeesHtVatTtc(standardOptionShippingHtCents, serviceHtCents).shippingTtcCents,
  );
  const expressOptionShippingTtcEuros = centsToEuros(
    computeCartFeesHtVatTtc(expressOptionShippingHtCents, serviceHtCents).shippingTtcCents,
  );
  const grandTotal = exchangeCreditsChargeEuros + feesTtcEuros;
  const complementMods = Math.max(0, cartTotalMods - walletAppliedMods);

  const relayPostalNorm = relayPostal.replace(/\D/g, "").slice(0, 5);
  const selectionPostalNorm = (selectedRelay?.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
  /** CP saisi = CP du point choisi (évite un relais « fantôme » issu du stockage alors que l’utilisateur a changé de CP). */
  const relayPostalMatchesSelection =
    selectedRelay != null &&
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

  const deliveryReady =
    deliveryChannel === "relay"
      ? relayPostalMatchesSelection && relayPickMatchesVisibleResults
      : deliveryAddress != null;

  const startStripeCheckout = useCallback(async () => {
    setStripeCheckoutError(null);
    if (!deliveryReady) {
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
          acceptRentalTerms: true,
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
    deliveryReady,
    homeSpeed,
    instructionsSaved,
    rentalTermsAccepted,
    selectedRelay,
    uberOutboundCentsFromQuote,
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
      const res = await fetch("/api/items/mondial-relay/relay-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postal_code: pc,
          country: "FR",
          weight_g: RELAY_SEARCH_WEIGHT_G,
          action: "24R",
        }),
      });
      const j = (await res.json()) as {
        points?: Array<{ code: string; label: string; postalCode?: string; city?: string }>;
        error?: string;
        hint?: string;
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
      }));
      setRelayPoints(list);
      if (list.length === 0) {
        setRelaySearchError(j.hint ?? "Aucun point relais pour ce code postal.");
        setSelectedRelay(null);
        writeCheckoutRelaySelection(null);
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
  }, [relayPostal]);

  const onSelectRelay = useCallback((r: CheckoutRelaySelection) => {
    setSelectedRelay(r);
    writeCheckoutRelaySelection(r);
    setRelayPoints((prev) => {
      if (prev.length === 0) return prev;
      const others = prev.filter((x) => x.code !== r.code);
      return [r, ...others];
    });
    window.setTimeout(() => {
      relayListScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  }, []);

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
    exitCartFlow(router);
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
              <h2 className={cn("mb-3 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
                Point relais
              </h2>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Store className="mt-0.5 h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-zinc-900">Mondial Relay</p>
                    {includedExchangeShipping !== "none" && includedShippingForfaitLine ? (
                      <p className="mt-0.5 text-[14px] font-bold leading-snug text-zinc-900">{includedShippingForfaitLine}</p>
                    ) : null}
                  </div>
                </div>
                <span className="shrink-0 pt-0.5 text-right text-[15px] font-semibold tabular-nums text-zinc-900">
                  {relayInboundShowsZero ? (
                    includedShippingQuotaLabel ? (
                      <span className="tabular-nums">{includedShippingQuotaLabel}</span>
                    ) : (
                      <span className="text-emerald-700">Offert</span>
                    )
                  ) : (
                    <>
                      {euros(shippingTtcEuros)}
                      <span className="ml-1 text-[11px] font-semibold text-zinc-500">TTC</span>
                    </>
                  )}
                </span>
              </div>
              <label className="block">
                <span className="text-[13px] font-medium text-zinc-600">Code postal (Mondial Relay)</span>
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={relayPostal}
                    onChange={(e) => setRelayPostal(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    placeholder="ex. 75017"
                    className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2.5 text-[16px] outline-none focus:border-zinc-400"
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
                          <p className="text-[15px] font-semibold text-zinc-900">{r.label}</p>
                          <p className="text-[13px] text-zinc-600">
                            {[r.postalCode, r.city].filter(Boolean).join(" · ")}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
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
                Options de livraison
              </h2>
              <div className="mt-3 grid gap-2">
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
                          {homeDeliveryShowsFullIncluded ? (
                            includedShippingQuotaLabel ? (
                              <span className="tabular-nums">{includedShippingQuotaLabel}</span>
                            ) : (
                              <span className="text-emerald-700">Offert</span>
                            )
                          ) : uberExpressShowsUnavailablePrice ? (
                            <span className="tabular-nums">{uberDirectUnavailablePriceLabel(uberQuoteErrorCode)}</span>
                          ) : (
                            <>
                              {euros(expressOptionShippingTtcEuros)}
                              <span className="ml-1 text-[11px] font-semibold text-zinc-500">TTC</span>
                            </>
                          )}
                        </span>
                      </div>
                      {uberArrivalLine ? (
                        <p className="mt-0.5 text-[13px] text-zinc-500">{uberArrivalLine}</p>
                      ) : null}
                    </div>
                  </button>
                  {showUberQuoteBelowCard ? (
                    <div
                      className={cn(
                        "px-3 pb-3",
                        uberQuotePanelPhaseForPanel === "error" ? "text-center" : "pl-[calc(1.25rem+0.75rem)]",
                      )}
                    >
                      <UberDirectQuotePanel
                        phase={uberQuotePanelPhaseForPanel}
                        errorMessage={uberQuoteError}
                        errorCode={uberQuoteErrorCode}
                      />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => persistHomeSpeed("standard")}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition",
                    homeSpeed === "standard" ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
                  )}
                >
                  <Home className="mt-0.5 h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
                  <div className="min-w-0 flex-1 pr-1">
                    <p className="text-[15px] font-semibold leading-tight text-zinc-900">
                      Aller - Retour Standard
                    </p>
                    <p className="mt-0.5 text-[13px] text-zinc-500">(2-3 jours ouvrés)</p>
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
                        {euros(standardOptionShippingTtcEuros)}
                        <span className="ml-1 text-[11px] font-semibold text-zinc-500">TTC</span>
                      </>
                    )}
                  </span>
                </button>
              </div>
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
              itemHrefSuffix=""
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
                <span className="shrink-0 font-medium text-zinc-900">
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
              <span
                className={cn(
                  "shrink-0 tabular-nums font-medium",
                  exchangeCreditsChargeEuros > 0 ? "text-red-600" : "text-zinc-900",
                )}
              >
                {euros(exchangeCreditsChargeEuros)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-zinc-700">
              <span className="min-w-0 pr-2">Frais de service (TTC)</span>
              <span className="shrink-0 font-medium tabular-nums text-zinc-900">{euros(serviceTtcEuros)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-zinc-700">
              <span className="min-w-0 pr-2">Frais de livraison (TTC)</span>
              <span className="shrink-0 font-medium tabular-nums text-zinc-900">{euros(shippingTtcEuros)}</span>
            </div>
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
            disabled={stripeCheckoutBusy || !deliveryReady || !rentalTermsAccepted || !uberBillingReady}
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
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  {deliveryChannel === "relay"
                    ? `Aller-retour point relais (${itemCount} article${itemCount > 1 ? "s" : ""}) : paliers poids par quantité, +1,00 € par article au-delà de 3 (base HT, TVA comprise dans le montant TTC).`
                    : deliveryChannel === "home"
                      ? homeSpeed === "uber_direct" && uberOutboundCentsFromQuote != null
                        ? `Prestation complète : enlèvement express à domicile (devis Uber) puis retour de tes articles via un point relais (${itemCount} article${itemCount > 1 ? "s" : ""}). Montant TTC (TVA 20 %).`
                        : `Aller domicile + retour relais selon le nombre d’articles (${itemCount}). Retour toujours en point relais. Montant TTC (TVA 20 %).`
                      : null}
                  {billedRoundTripSubtotalCents === 0 && includedExchangeShipping !== "none" ? (
                    <span className="mt-1 block text-emerald-800/90">
                      {includedExchangeShipping === "guest_relay_round_trip_equivalent"
                        ? "La partie point relais du barème aller-retour est prise en charge pour cette commande"
                        : "Le trajet aller-retour du barème est pris en charge par ton abonnement"}
                      {remainingIncludedOrdersThisMonth > 0
                        ? ` (${remainingIncludedOrdersThisMonth} inclusion${remainingIncludedOrdersThisMonth > 1 ? "s" : ""} restante${remainingIncludedOrdersThisMonth > 1 ? "s" : ""} ce mois-ci avant paiement)`
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
