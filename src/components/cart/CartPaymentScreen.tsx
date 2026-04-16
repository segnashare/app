"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Check, ChevronLeft, ChevronRight, Home, Store, User, Zap } from "lucide-react";

import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import { CommandeOrderLineRows } from "@/components/commande/CommandeOrderLineRows";
import { segnaDialogBodyClass, segnaDialogTitleClass, SEGNA_DIALOG_SHEET_CLASS } from "@/components/ui/SegnaAppDialog";
import {
  isParisDeliveryArea,
  readCheckoutDeliveryAddress,
  readCheckoutDeliveryInstructions,
  readCheckoutRelaySelection,
  writeCheckoutDeliveryInstructions,
  writeCheckoutRelaySelection,
  type CheckoutDeliveryAddress,
  type CheckoutRelaySelection,
} from "@/lib/cart/checkout-delivery-storage";
import { CART_CHECKOUT_VAT_LABEL, computeCartFeesHtVatTtc } from "@/lib/cart/cart-checkout-vat";
import {
  CART_PRIORITY_PARIS_SURCHARGE_CENTS,
  CART_PRIORITY_PARIS_SURCHARGE_EUROS,
  cartPaymentServiceFeeHtCents,
} from "@/lib/cart/cart-payment-fees";
import { includedOrdersUsedThisMonth } from "@/lib/billing/membership-included-orders";
import { CART_RESERVED_AT_STORAGE_KEY } from "@/lib/cart/reservation-timer";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
import { walletCreditKindLabel } from "@/lib/wallet/credit-kind";
import {
  centsToEuros,
  computeExchangeRoundTripShippingCents,
} from "@/lib/shipping/exchange-shipping-pricing";
import { SegnaConsumptionCreditPhrase, SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const TIMER_MS = 10 * 60 * 1000;
const RELAY_SEARCH_WEIGHT_G = 900;

function euros(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

type DeliveryChannel = "relay" | "home";
type HomeDeliverySpeed = "standard" | "priority";

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
  /** Solde wallet au moment du chargement — pour l’explication « couvert par le solde ». */
  availableWalletMods: number;
  /** Invité : pas de compteur explicite en tête (réservation serveur inchangée). */
  hideReservationTimer?: boolean;
  /**
   * Aller-retour non facturé : abonné avec quota `remaining_orders_this_month` > 0
   * (plafonds `billing_plan_entitlement_limits.included_orders_limit`).
   */
  waiveIncludedRoundTripShipping?: boolean;
  /** Repère affichage / cohérence avec le serveur au chargement de la page. */
  remainingIncludedOrdersThisMonth?: number;
  /** Plafond mensuel `included_orders_limit` (pour affichage type 1/2). */
  includedOrdersLimitThisMonth?: number;
  /** Sous-titre bleu sous Mondial Relay (forfait SegnaX / Segna+). */
  includedShippingForfaitLine?: string;
  /** Retour Stripe `/api/stripe/cart/sync` en erreur (débit wallet ou confirmation panier). */
  postStripeSyncError?: { reason: string; detail?: string } | null;
};

export function CartPaymentScreen({
  initialLines,
  walletCreditKind,
  exchangeCreditsChargeEuros,
  availableWalletMods,
  hideReservationTimer = false,
  waiveIncludedRoundTripShipping = false,
  remainingIncludedOrdersThisMonth = 0,
  includedOrdersLimitThisMonth = 0,
  includedShippingForfaitLine,
  postStripeSyncError = null,
}: CartPaymentScreenProps) {
  const creditKindLabel = walletCreditKindLabel(walletCreditKind);
  const router = useRouter();
  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>("relay");
  const [homeSpeed, setHomeSpeed] = useState<HomeDeliverySpeed>("standard");
  const [relayPostal, setRelayPostal] = useState("");
  const [relayPoints, setRelayPoints] = useState<CheckoutRelaySelection[]>([]);
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

  const refreshCheckoutLocalState = useCallback(() => {
    setDeliveryAddress(readCheckoutDeliveryAddress());
    setInstructionsDraft(readCheckoutDeliveryInstructions());
    setInstructionsSaved(readCheckoutDeliveryInstructions());
    setSelectedRelay(readCheckoutRelaySelection());
  }, []);

  useEffect(() => {
    refreshCheckoutLocalState();
  }, [refreshCheckoutLocalState]);

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

  const isParis = useMemo(() => isParisDeliveryArea(deliveryAddress), [deliveryAddress]);

  useEffect(() => {
    if (deliveryChannel === "home" && !isParis && homeSpeed === "priority") {
      setHomeSpeed("standard");
    }
  }, [deliveryChannel, isParis, homeSpeed]);

  const itemCount = initialLines.length;
  const cartTotalMods = useMemo(
    () => initialLines.reduce((sum, line) => sum + line.pricePoints, 0),
    [initialLines],
  );
  const walletAppliedMods = Math.min(cartTotalMods, Math.max(0, availableWalletMods));
  const walletAppliedModsFloor = Math.floor(walletAppliedMods);
  const walletAppliedModsFormattedFr = walletAppliedModsFloor.toLocaleString("fr-FR");
  const walletCoverBalanceAriaLabel =
    walletCreditKind === "consumption"
      ? `${walletAppliedModsFormattedFr} ${walletAppliedModsFloor === 1 ? "point" : "points"} Segna de consommation pris sur ton solde`
      : `${walletAppliedModsFormattedFr} ${creditKindLabel} pris sur ton solde`;
  const exchangeShipping = useMemo(
    () =>
      computeExchangeRoundTripShippingCents(itemCount, deliveryChannel === "relay" ? "relay" : "home"),
    [itemCount, deliveryChannel],
  );
  /** Tarif barème (affichage détail) ; la facturation peut être à 0 si forfait abonnement. */
  const referenceRoundTripEuros = centsToEuros(exchangeShipping.subtotalCents);
  const billedRoundTripSubtotalCents = waiveIncludedRoundTripShipping ? 0 : exchangeShipping.subtotalCents;
  const billedRoundTripEuros = centsToEuros(billedRoundTripSubtotalCents);

  const includedShippingQuotaLabel =
    waiveIncludedRoundTripShipping && includedOrdersLimitThisMonth > 0
      ? `${includedOrdersUsedThisMonth(remainingIncludedOrdersThisMonth, includedOrdersLimitThisMonth)}/${includedOrdersLimitThisMonth}`
      : null;

  const prioritySurchargeEuro =
    deliveryChannel === "home" && isParis && homeSpeed === "priority" ? CART_PRIORITY_PARIS_SURCHARGE_EUROS : 0;
  const deliveryEuroHt = billedRoundTripEuros + prioritySurchargeEuro;
  const serviceHtCents = cartPaymentServiceFeeHtCents(itemCount);
  const serviceEuroHt = centsToEuros(serviceHtCents);

  const shippingHtCents = useMemo(() => {
    const priorityCents =
      deliveryChannel === "home" && isParis && homeSpeed === "priority" ? CART_PRIORITY_PARIS_SURCHARGE_CENTS : 0;
    return billedRoundTripSubtotalCents + priorityCents;
  }, [deliveryChannel, billedRoundTripSubtotalCents, homeSpeed, isParis]);

  const feesPricing = useMemo(
    () => computeCartFeesHtVatTtc(shippingHtCents, serviceHtCents),
    [shippingHtCents, serviceHtCents],
  );

  const feesHtEuros = centsToEuros(feesPricing.feesHtCents);
  const feesVatEuros = centsToEuros(feesPricing.feesVatCents);
  const feesTtcEuros = centsToEuros(feesPricing.feesTtcCents);
  const serviceTtcEuros = centsToEuros(feesPricing.serviceTtcCents);
  const shippingTtcEuros = centsToEuros(feesPricing.shippingTtcCents);
  const grandTotal = exchangeCreditsChargeEuros + feesTtcEuros;
  const complementMods = Math.max(0, cartTotalMods - walletAppliedMods);

  const deliveryReady =
    deliveryChannel === "relay" ? selectedRelay != null : deliveryAddress != null;

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
  }, [deliveryAddress, deliveryChannel, deliveryReady, homeSpeed, rentalTermsAccepted, selectedRelay]);

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
      };
      if (!res.ok) {
        setRelaySearchError(userFacingRelaySearchError(res.status, j.error));
        setRelayPoints([]);
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
      }
    } catch {
      setRelaySearchError("Recherche impossible. Réessaie dans un instant.");
      setRelayPoints([]);
    } finally {
      setRelayLoading(false);
    }
  }, [relayPostal]);

  const onSelectRelay = useCallback((r: CheckoutRelaySelection) => {
    setSelectedRelay(r);
    writeCheckoutRelaySelection(r);
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
    router.back();
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
              onClick={() => setDeliveryChannel("relay")}
              className={cn(
                "min-h-[40px] flex-1 rounded-full px-2 py-2 text-center text-[14px] font-semibold transition",
                deliveryChannel === "relay" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600",
              )}
            >
              Point relais
            </button>
            <button
              type="button"
              onClick={() => setDeliveryChannel("home")}
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
                    <p className="text-[13px] leading-snug text-zinc-500">
                      Aller-retour en relais · 3–5 j ouvrés · selon disponibilités
                      {waiveIncludedRoundTripShipping && includedShippingForfaitLine ? (
                        <span className="mt-0.5 block text-[13px] font-medium text-blue-700">{includedShippingForfaitLine}</span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 pt-0.5 text-right text-[15px] font-semibold tabular-nums text-zinc-900">
                  {waiveIncludedRoundTripShipping ? (
                    includedShippingQuotaLabel ? (
                      <span className="tabular-nums">{includedShippingQuotaLabel}</span>
                    ) : (
                      <span className="text-emerald-700">Offert</span>
                    )
                  ) : (
                    <>
                      {euros(billedRoundTripEuros)}
                      <span className="ml-1 text-[11px] font-semibold text-zinc-500">HT</span>
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
                <ul className="mt-3 max-h-[240px] space-y-2 overflow-y-auto pr-0.5">
                  {relayPoints.map((r) => (
                    <li key={r.code}>
                      <button
                        type="button"
                        onClick={() => onSelectRelay(r)}
                        className={cn(
                          "w-full rounded-xl border px-3 py-3 text-left transition",
                          selectedRelay?.code === r.code ? "border-zinc-900 bg-zinc-50" : "border-zinc-200",
                        )}
                      >
                        <p className="text-[15px] font-semibold text-zinc-900">{r.label}</p>
                        <p className="text-[13px] text-zinc-600">
                          {[r.postalCode, r.city].filter(Boolean).join(" · ")}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {selectedRelay ? (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50/90 px-3 py-3">
                  <Store className="mt-0.5 h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">Point relais choisi</p>
                    <p className="text-[15px] font-semibold text-zinc-900">{selectedRelay.label}</p>
                    <p className="text-[13px] text-zinc-600">
                      {[selectedRelay.postalCode, selectedRelay.city].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
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
              <p className="mt-2 text-[13px] text-zinc-500">Créneaux indicatifs — confirmation après paiement.</p>
              <div className="mt-3 grid gap-2">
                {isParis ? (
                  <button
                    type="button"
                    onClick={() => setHomeSpeed("priority")}
                    className={cn(
                      "relative flex w-full items-start gap-3 overflow-hidden rounded-xl border px-3 pb-8 pt-3 text-left transition",
                      homeSpeed === "priority" ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
                    )}
                  >
                    <Zap className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-semibold text-zinc-900">Priorité</p>
                        <span className="shrink-0 text-right text-[14px] font-semibold tabular-nums text-zinc-900">
                          +{euros(CART_PRIORITY_PARIS_SURCHARGE_EUROS)}
                          <span className="ml-1 text-[11px] font-semibold text-zinc-500">HT</span>
                        </span>
                      </div>
                      <p className="text-[13px] text-zinc-500">25 min – 45 min · Paris</p>
                    </div>
                    <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-zinc-900/88 px-2 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white">
                        Service prioritaire réservé aux livraisons à Paris
                      </p>
                    </div>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setHomeSpeed("standard")}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition",
                    homeSpeed === "standard" ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
                  )}
                >
                  <Home className="mt-0.5 h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[15px] font-semibold text-zinc-900">Standard</p>
                      <span className="shrink-0 text-right text-[14px] font-semibold tabular-nums text-zinc-900">
                        {waiveIncludedRoundTripShipping ? (
                          includedShippingQuotaLabel ? (
                            <span className="tabular-nums">{includedShippingQuotaLabel}</span>
                          ) : (
                            <span className="text-emerald-700">Offert</span>
                          )
                        ) : (
                          <>
                            {euros(billedRoundTripEuros)}
                            <span className="ml-1 text-[11px] font-semibold text-zinc-500">HT</span>
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-[13px] text-zinc-500">
                      Aller domicile + retour relais · 45 min – 1 h 30 · selon disponibilités
                    </p>
                  </div>
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
          <h2 className={cn("mb-4 min-w-0", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
            Frais facturés
          </h2>
          {walletAppliedMods > 0 ? (
            <p
              className="mb-4 text-[12px] leading-snug text-zinc-500"
              aria-label={walletCoverBalanceAriaLabel}
            >
              <span className="tabular-nums">{walletAppliedModsFormattedFr}</span>{" "}
              {walletCreditKind === "consumption" ? (
                <SegnaConsumptionCreditPhrase textClassName="text-zinc-500" />
              ) : (
                <span>{creditKindLabel}</span>
              )}{" "}
              pris sur ton solde
              {exchangeCreditsChargeEuros > 0
                ? ` — complément ${euros(exchangeCreditsChargeEuros)} à régler en €.`
                : " — aucun complément € sur les articles."}
            </p>
          ) : null}
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
              <span className="inline-flex min-w-0 items-center gap-1 pr-2">
                Frais de livraison (TTC)
                <button
                  type="button"
                  onClick={() => setFeesModalOpen(true)}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[11px] font-semibold text-zinc-500"
                  aria-label="Détail des frais"
                >
                  i
                </button>
              </span>
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
            disabled={stripeCheckoutBusy || !deliveryReady || !rentalTermsAccepted}
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
                  <span className="text-[15px] font-semibold text-zinc-900">Service (HT)</span>
                  <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{euros(serviceEuroHt)}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  Frais fixes pour le traitement et le suivi de ta commande.
                </p>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px] font-semibold text-zinc-900">Livraison (HT)</span>
                  <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{euros(deliveryEuroHt)}</span>
                </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  {deliveryChannel === "home"
                    ? isParis && homeSpeed === "priority"
                      ? `Aller domicile + retour relais (${waiveIncludedRoundTripShipping ? "offert" : `${euros(referenceRoundTripEuros)} HT`}) + priorité Paris (${euros(CART_PRIORITY_PARIS_SURCHARGE_EUROS)} HT).`
                      : `Aller domicile + retour relais selon le nombre d’articles (${itemCount}). Retour toujours en point relais.`
                    : `Aller-retour point relais (${itemCount} article${itemCount > 1 ? "s" : ""}) : paliers poids par quantité, +1,00 € HT par article au-delà de 3.`}
                  {waiveIncludedRoundTripShipping ? (
                    <span className="mt-1 block text-emerald-800/90">
                      Le trajet aller-retour du barème est pris en charge par ton abonnement
                      {remainingIncludedOrdersThisMonth > 0
                        ? ` (${remainingIncludedOrdersThisMonth} inclusion${remainingIncludedOrdersThisMonth > 1 ? "s" : ""} restante${remainingIncludedOrdersThisMonth > 1 ? "s" : ""} ce mois-ci avant paiement)`
                        : ""}
                      .
                    </span>
                  ) : null}
                </p>
                <div className="mt-2 space-y-1 border-t border-zinc-100 pt-2 text-[12px] text-zinc-600">
                  <div className="flex justify-between gap-2">
                    <span>Aller (HT)</span>
                    <span className="tabular-nums text-right">
                      {waiveIncludedRoundTripShipping ? (
                        <span className="text-emerald-700">Offert</span>
                      ) : (
                        euros(centsToEuros(exchangeShipping.outboundCents))
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Retour relais (HT)</span>
                    <span className="tabular-nums text-right">
                      {waiveIncludedRoundTripShipping ? (
                        <span className="text-emerald-700">Offert</span>
                      ) : (
                        euros(centsToEuros(exchangeShipping.returnRelayCents))
                      )}
                    </span>
                  </div>
                  {prioritySurchargeEuro > 0 ? (
                    <div className="flex justify-between gap-2">
                      <span>Priorité Paris (HT)</span>
                      <span className="tabular-nums">{euros(prioritySurchargeEuro)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-baseline justify-between border-t border-zinc-200 pt-3">
                <span className="text-[15px] font-semibold text-zinc-900">Total frais HT</span>
                <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{euros(feesHtEuros)}</span>
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
