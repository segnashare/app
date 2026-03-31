"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Home,
  Store,
  Tag,
  User,
  Zap,
} from "lucide-react";

import type { CartLineRowData } from "@/components/cart/CartScreen";
import { formatOtherMembersDiscreteLine } from "@/lib/cart/cart-competition-copy";
import type { CartLineStatus } from "@/components/exchange/ExchangeCartSection";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
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
import { CART_RESERVED_AT_STORAGE_KEY } from "@/lib/cart/reservation-timer";
import { cn } from "@/lib/utils/cn";

const TIMER_MS = 10 * 60 * 1000;
const RELAY_SEARCH_WEIGHT_G = 900;

/** Récap panier paiement : bleu = ligne réservée (wallet), gris = non réservée. */
function paymentCartLineChrome(status: CartLineStatus) {
  const reserved = status === "reserve";
  return {
    row: reserved
      ? "border-l-[3px] border-l-blue-500 bg-blue-50/80 hover:bg-blue-50"
      : "border-l-[3px] border-l-zinc-300 bg-zinc-100/70 hover:bg-zinc-100",
    title: reserved ? "text-blue-950" : "text-zinc-800",
    brand: reserved ? "text-blue-700/80" : "text-zinc-500",
    price: reserved ? "text-blue-900" : "text-zinc-600",
    thumbRing: reserved ? "ring-1 ring-blue-200/80" : "ring-1 ring-zinc-200",
    badge: reserved ? "bg-blue-100 text-blue-800" : "bg-zinc-200 text-zinc-600",
  };
}

const DELIVERY_HOME_EUROS = 6.49;
const DELIVERY_RELAY_EUROS = 2.99;
const DELIVERY_PRIORITY_SURCHARGE_EUROS = 1.49;
const SERVICE_FEE_EUROS = 0.99;

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
  /** Sous-total € (mods / crédits convertis comme sur le panier). */
  subtotalEuros: number;
  /** Invité : pas de compteur explicite en tête (réservation serveur inchangée). */
  hideReservationTimer?: boolean;
  /** Guest / Membre + : ne pas afficher pastille ni surlignage « réservé wallet » (comportement serveur inchangé). */
  hideWalletReservationChrome?: boolean;
};

export function CartPaymentScreen({
  initialLines,
  subtotalEuros,
  hideReservationTimer = false,
  hideWalletReservationChrome = false,
}: CartPaymentScreenProps) {
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
  const [panierOpen, setPanierOpen] = useState(false);
  const [feesModalOpen, setFeesModalOpen] = useState(false);
  const [newsletterOn, setNewsletterOn] = useState(false);
  const [remainingMs, setRemainingMs] = useState(TIMER_MS);

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

  const prioritySurchargeEuro =
    deliveryChannel === "home" && isParis && homeSpeed === "priority" ? DELIVERY_PRIORITY_SURCHARGE_EUROS : 0;
  const deliveryEuro =
    deliveryChannel === "home" ? DELIVERY_HOME_EUROS + prioritySurchargeEuro : DELIVERY_RELAY_EUROS;
  const serviceEuro = SERVICE_FEE_EUROS;
  const feesTotal = serviceEuro + deliveryEuro;
  const grandTotal = subtotalEuros + feesTotal;

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
    <div className="flex min-h-[100dvh] flex-col bg-zinc-100">
      {/* Header — fixe en haut pendant le scroll */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-zinc-200 bg-white px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px)+8px)]">
        <div className="relative mx-auto flex h-11 max-w-[430px] items-center justify-between">
          <div className="flex w-14 shrink-0 justify-start">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-800"
              aria-label="Retour"
            >
              <ChevronLeft className="h-7 w-7" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
          <h1 className="pointer-events-none absolute left-1/2 top-1/2 z-0 max-w-[min(100%,12rem)] -translate-x-1/2 -translate-y-1/2 text-center text-[17px] font-semibold text-zinc-900">
            Paiement
          </h1>
          {hideReservationTimer ? (
            <div className="w-14 shrink-0" aria-hidden />
          ) : (
            <div
              className={cn(
                "flex w-14 shrink-0 justify-end font-mono text-[17px] font-semibold tabular-nums leading-none tracking-tight",
                timerLastMinute ? "text-red-600" : "text-zinc-900",
              )}
              title="Temps restant pour finaliser"
            >
              {formatMmSs(remainingMs)}
            </div>
          )}
        </div>
      </header>

      {/* Décalage = hauteur header (safe area + barre titre + pb) */}
      {/* Une colonne blanche, séparations fines type lignes d’items (pas de gutter zinc entre sections) */}
      <div className="mx-auto w-full max-w-[430px] flex-1 bg-white pt-[calc(max(0.75rem,env(safe-area-inset-top,0px)+8px)+3.25rem)] pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="divide-y divide-zinc-200">
        {/* Switch Point relais / Domicile */}
        <section className="px-5 py-4">
          <div className="flex rounded-full bg-[#8B6A54]/14 p-1">
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
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Store className="mt-0.5 h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-zinc-900">Mondial Relay</p>
                    <p className="text-[13px] leading-snug text-zinc-500">3–5 j ouvrés · selon disponibilités</p>
                  </div>
                </div>
                <span className="shrink-0 pt-0.5 text-[15px] font-semibold tabular-nums text-zinc-900">
                  {euros(DELIVERY_RELAY_EUROS)}
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
                    className="shrink-0 rounded-xl bg-gradient-to-b from-[#5E3023] to-[#895737] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm disabled:opacity-60"
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
              <h2 className="text-[17px] font-bold text-zinc-900">Options de livraison</h2>
              <p className="mt-1 text-[13px] text-zinc-500">Créneaux indicatifs — confirmation après paiement.</p>
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
                        <span className="shrink-0 text-[14px] font-semibold tabular-nums text-zinc-900">
                          +{euros(DELIVERY_PRIORITY_SURCHARGE_EUROS)}
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
                    <p className="text-[15px] font-semibold text-zinc-900">Standard</p>
                    <p className="text-[13px] text-zinc-500">45 min – 1 h 30 · selon disponibilités</p>
                  </div>
                </button>
              </div>
            </section>
          </>
        )}

        {/* Récap panier */}
        <section className="px-5 py-4">
          <button
            type="button"
            onClick={() => setPanierOpen((o) => !o)}
            className="flex w-full items-center gap-3 text-left"
          >
            <img
              src="/icon/segan.svg"
              alt=""
              className="h-10 w-10 shrink-0 object-contain"
              width={40}
              height={40}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-bold text-zinc-900">Panier</p>
              <p className="text-[14px] text-zinc-500">
                {initialLines.length} article{initialLines.length > 1 ? "s" : ""}
              </p>
            </div>
            <ChevronDown
              className={cn("h-5 w-5 shrink-0 text-zinc-500 transition", panierOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          {panierOpen ? (
            <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-3">
              {initialLines.map((line) => {
                const chromeStatus: CartLineStatus =
                  hideWalletReservationChrome && line.status === "reserve" ? "disponible" : line.status;
                const chrome = paymentCartLineChrome(chromeStatus);
                const otherMembersHint = formatOtherMembersDiscreteLine(line.otherShoppersInCart ?? 0);
                return (
                  <li key={line.id}>
                    <Link
                      href={`/items/${line.itemId}`}
                      className={cn(
                        "flex gap-3 rounded-r-xl rounded-l-sm py-2.5 pl-2 pr-2 transition active:opacity-90",
                        chrome.row,
                      )}
                    >
                      <div
                        className={cn(
                          "h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/80",
                          chrome.thumbRing,
                        )}
                      >
                        {line.photoUrl ? (
                          <RemoteCoverThumb
                            photoUrl={line.photoUrl}
                            photoPosition={line.photoPosition}
                            frameClassName="h-14 w-14"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-[14px] font-semibold leading-tight", chrome.title)}>{line.itemName}</p>
                        {otherMembersHint ? (
                          <p className="mt-0.5 text-[12px] italic leading-snug text-zinc-500">{otherMembersHint}</p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 gap-y-1">
                          {!hideWalletReservationChrome && line.status === "reserve" ? (
                            <span
                              className={cn(
                                "inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                chrome.badge,
                              )}
                            >
                              Réservé
                            </span>
                          ) : null}
                          {line.status === "en_attente_wallet" ? (
                            <span className="inline-flex shrink-0 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                              Non réservé
                            </span>
                          ) : null}
                          {line.status === "echec" ? (
                            <span className="inline-flex shrink-0 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-800">
                              À vérifier
                            </span>
                          ) : null}
                        </div>
                        {line.brand ? (
                          <p className={cn("mt-0.5 text-[12px] leading-tight", chrome.brand)}>{line.brand}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end justify-center self-stretch pl-1">
                        <p
                          className={cn(
                            "text-[14px] font-semibold tabular-nums tracking-tight",
                            chrome.price,
                          )}
                        >
                          {Math.floor(line.pricePoints).toLocaleString("fr-FR")} mods
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        {/* Moyen de paiement */}
        <section className="px-5 py-4">
          <h2 className="text-[17px] font-bold text-zinc-900">Moyen de paiement</h2>
          <button
            type="button"
            className="mt-3 flex w-full items-center justify-between gap-3 rounded-lg py-2 text-left"
          >
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-zinc-900">Carte bancaire</p>
              <p className="text-[13px] text-zinc-500">Visa, Mastercard, Apple Pay</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />
          </button>
        </section>

        <section className="px-5 py-4">
          <button type="button" className="flex w-full items-center gap-3 py-2 text-left">
            <Tag className="h-5 w-5 shrink-0 text-zinc-700" aria-hidden />
            <span className="flex-1 text-[15px] text-zinc-900">Ajouter un code promotionnel</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />
          </button>
        </section>

        {/* Totaux */}
        <section className="px-5 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[15px] text-zinc-600">Sous-total</span>
            <span className="text-[15px] font-medium tabular-nums text-zinc-900">{euros(subtotalEuros)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[15px] text-zinc-600">
              Frais
              <button
                type="button"
                onClick={() => setFeesModalOpen(true)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 text-[11px] font-semibold text-zinc-500"
                aria-label="Détail des frais"
              >
                i
              </button>
            </span>
            <span className="text-[15px] font-medium tabular-nums text-zinc-900">{euros(feesTotal)}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-zinc-200 pt-3">
            <span className="text-[18px] font-bold text-zinc-900">Total</span>
            <span className="text-[18px] font-bold tabular-nums text-zinc-900">{euros(grandTotal)}</span>
          </div>
        </section>

        {/* Newsletter — case alignée sur la 1re ligne de texte, taille proche des autres cases du flux */}
        <section className="px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[15px] font-normal leading-snug text-zinc-900">
                Inscrivez-vous pour recevoir par e-mail l&apos;actualité et les offres de :{" "}
                <span className="font-semibold">Segna</span>.
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Déclaration de confidentialité : en cochant cette case, vous acceptez de recevoir des communications
                marketing de la part de Segna. Vous pourrez vous désinscrire à tout moment.
              </p>
              <p className="pt-1 text-[11px] leading-relaxed text-zinc-500">
                <Link href="/legal/confidentialite" className="font-semibold text-[#5E3023] underline underline-offset-2">
                  Politique de confidentialité
                </Link>
                {" · "}
                <Link href="/legal/contrat-services" className="font-semibold text-[#5E3023] underline underline-offset-2">
                  Contrat sur les services
                </Link>
              </p>
            </div>
            <label className="relative mt-[0.2em] inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center self-start">
              <input
                type="checkbox"
                checked={newsletterOn}
                onChange={(e) => setNewsletterOn(e.target.checked)}
                className="peer sr-only"
                aria-label="S’inscrire à la newsletter Segna"
              />
              <span
                className={cn(
                  "pointer-events-none flex size-[18px] items-center justify-center rounded-sm border border-zinc-900 bg-white peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-400 peer-focus-visible:ring-offset-2",
                  newsletterOn && "border-zinc-900 bg-zinc-900",
                )}
                aria-hidden
              >
                {newsletterOn ? <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden /> : null}
              </span>
            </label>
          </div>
        </section>
        </div>
      </div>

      {/* Dock CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto max-w-[430px]">
          <button
            type="button"
            className="flex h-[52px] w-full items-center justify-center rounded-xl bg-gradient-to-b from-[#5E3023] to-[#895737] text-[16px] font-bold text-white shadow-sm"
          >
            Commander et payer
          </button>
        </div>
      </div>

      {/* Modale frais */}
      {feesModalOpen ? (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={() => setFeesModalOpen(false)}>
          <div
            className="max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white px-5 pb-8 pt-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />
            <h3 className="text-center text-[17px] font-bold text-zinc-900">Ce que comprennent vos frais</h3>
            <div className="mt-6 space-y-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px] font-semibold text-zinc-900">Service</span>
                  <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{euros(serviceEuro)}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  Frais fixes pour le traitement et le suivi de ta commande.
                </p>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px] font-semibold text-zinc-900">Livraison</span>
                  <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{euros(deliveryEuro)}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                  {deliveryChannel === "home"
                    ? isParis && homeSpeed === "priority"
                      ? `Domicile : forfait ${euros(DELIVERY_HOME_EUROS)} + priorité Paris ${euros(DELIVERY_PRIORITY_SURCHARGE_EUROS)}.`
                      : "Livraison à l’adresse indiquée (forfait domicile)."
                    : "Retrait en point relais Mondial Relay sélectionné."}
                </p>
              </div>
              <div className="flex items-baseline justify-between border-t border-zinc-200 pt-4">
                <span className="text-[16px] font-bold text-zinc-900">Total des frais</span>
                <span className="text-[16px] font-bold tabular-nums text-zinc-900">{euros(feesTotal)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFeesModalOpen(false)}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-b from-[#5E3023] to-[#895737] text-[15px] font-bold text-white shadow-sm"
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
          <div
            className="max-h-[85dvh] rounded-t-2xl bg-white px-5 pb-8 pt-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-zinc-200" aria-hidden />
            <h3 className="text-center text-[17px] font-bold text-zinc-900">Instructions de livraison</h3>
            <p className="mt-2 text-center text-[13px] text-zinc-500">Interphone, digicode, étage…</p>
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
              className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-b from-[#5E3023] to-[#895737] text-[15px] font-bold text-white shadow-sm"
            >
              Enregistrer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
