"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Info, Plus, Trash2, X } from "lucide-react";

import { ExchangeWalletPill } from "@/components/exchange/ExchangeWalletPill";
import {
  CART_LINE_STATUS_CLASSNAMES,
  type CartLineStatus,
} from "@/components/exchange/ExchangeCartSection";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { EXCHANGE_CREDIT_CENTS_PER_MOD } from "@/lib/cart/exchangeCredits";
import { setCartReservationTimerStart } from "@/lib/cart/reservation-timer";
import { formatOtherMembersDiscreteLine } from "@/lib/cart/cart-competition-copy";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import { sortCartLinesByPriceAsc } from "@/lib/cart/sort-cart-lines-by-price";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

export type CartLineRowData = {
  id: string;
  itemId: string;
  itemName: string;
  brand: string | null;
  description: string | null;
  pricePoints: number;
  status: CartLineStatus;
  photoUrl: string | null;
  photoPosition: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
  /** Autres paniers actifs avec la même pièce (cart_items.status = in_cart). */
  otherShoppersInCart?: number;
  /** items.status = reserved par un autre membre (pas ta ligne réservée). */
  reservedByOther?: boolean;
  /** `carts.locked_until` du panier concurrent (ISO), pour compteur fin de réservation. */
  reservedUntilAt?: string | null;
};

type OfferCardData = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  accent: string;
};

type CartScreenProps = {
  initialLines: CartLineRowData[];
  /** Panier actif côté serveur (réservation RPC). */
  activeCartId: string | null;
  cartStatus: string | null;
  membershipLabel: "Guest" | "Membre +" | "Membre X";
  availablePoints: number;
  hasReachedLendingCap: boolean;
  insuranceEuros: number;
  showSubscriptionUpsell: boolean;
  subscriptionUpsellHref: string;
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
    subtitle: "Prête une pièce — gagne des mods",
    href: "/exchange",
    accent: "from-emerald-50 to-teal-50",
  },
];

function euros(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function cartLineStatusLabelFr(status: CartLineStatus): string {
  if (status === "disponible") return "Disponible";
  if (status === "reserve") return "Réservé";
  if (status === "en_attente_wallet") return "Non réservé";
  return "À vérifier";
}

function parseCompetitionExpiryMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withT = /^\d{4}-\d{2}-\d{2}[ T]\d/.test(trimmed) ? trimmed.replace(" ", "T") : trimmed;
  const ms = Date.parse(withT);
  return Number.isNaN(ms) ? null : ms;
}

/** Compteur jusqu’à fin de réservation concurrente (locked_until / hold). */
function CompetitionReservationCountdown({ expiresAt }: { expiresAt: string | null | undefined }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const iso = expiresAt?.trim() ?? "";
  const timerWrap =
    "inline-flex min-w-[4.25rem] items-center justify-center rounded-lg bg-zinc-900/72 px-3 py-1.5 text-[17px] font-semibold tabular-nums tracking-wide text-white backdrop-blur-sm";
  if (!iso) {
    return <span className={timerWrap}>--:--</span>;
  }
  const end = parseCompetitionExpiryMs(iso);
  if (end == null) {
    return <span className={timerWrap}>--:--</span>;
  }
  const ms = Math.max(0, end - nowMs);
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return (
    <span className={timerWrap}>
      {mm}:{ss.toString().padStart(2, "0")}
    </span>
  );
}

export function CartScreen({
  initialLines,
  activeCartId,
  cartStatus,
  membershipLabel,
  availablePoints,
  hasReachedLendingCap,
  insuranceEuros,
  showSubscriptionUpsell,
  subscriptionUpsellHref,
}: CartScreenProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient() as any, []);
  const balanceUnitLabel = membershipLabel === "Guest" ? "pods" : "mods";
  const isGuest = membershipLabel === "Guest";
  const [lines, setLines] = useState<CartLineRowData[]>(() => sortCartLinesByPriceAsc(initialLines));
  const [reserveBusy, setReserveBusy] = useState(false);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [insuranceOn, setInsuranceOn] = useState(false);
  const [exchangeCreditsInfoOpen, setExchangeCreditsInfoOpen] = useState(false);
  const [walletPanelOpen, setWalletPanelOpen] = useState(false);
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);
  const [lineRemoveError, setLineRemoveError] = useState<string | null>(null);

  /** Option protection commande uniquement (hors crédits d’échange). */
  const cashFees = useMemo(() => (insuranceOn ? insuranceEuros : 0), [insuranceEuros, insuranceOn]);

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
  /** Lignes dont le prix seul dépasse la capacité (article « à surplus »). */
  const isSurplusLine = (line: CartLineRowData) => line.pricePoints > availablePoints;
  const missingExchangeMods = cartExceedsWallet ? Math.max(0, cartTotalPoints - availablePoints) : 0;
  const exchangeCreditsEuroCents = missingExchangeMods * EXCHANGE_CREDIT_CENTS_PER_MOD;
  /** Protection (si cochée) + crédits d’échange si besoin. */
  const subtotalCashFees = useMemo(() => {
    const creditsEuros = cartExceedsWallet ? exchangeCreditsEuroCents / 100 : 0;
    return cashFees + creditsEuros;
  }, [cashFees, cartExceedsWallet, exchangeCreditsEuroCents]);

  useEffect(() => {
    if (!cartExceedsWallet) setExchangeCreditsInfoOpen(false);
  }, [cartExceedsWallet]);

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
        const msg = raw.includes("INSUFFICIENT_WALLET_CAPACITY")
          ? "Aucune pièce ne tient dans ta capacité d’emprunt pour l’instant."
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
        const isNewReservation = !payload.already_reserved && !payload.idempotent;
        if (isNewReservation && !isGuest) {
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

  /** Sous-titre type Uber Eats : durée d’emprunt (abonnés = 1 mois, invité = location 7 j.). */
  const panierSubtitle = useMemo(() => {
    if (membershipLabel === "Guest") {
      return "7 jours de location à partir de la réception de votre commande";
    }
    const until = new Date();
    until.setMonth(until.getMonth() + 1);
    const dd = String(until.getDate()).padStart(2, "0");
    const mm = String(until.getMonth() + 1).padStart(2, "0");
    return `Emprunte jusqu'au ${dd}/${mm} (1 mois)`;
  }, [membershipLabel]);

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
    : showSubscriptionUpsell
      ? "calc(158px + env(safe-area-inset-bottom, 0px))"
      : "calc(88px + env(safe-area-inset-bottom, 0px))";

  return (
    <div className="flex w-full flex-col bg-zinc-100">
      <header className="fixed left-1/2 top-0 z-40 w-full max-w-[430px] -translate-x-1/2 border-b border-zinc-100 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label="Retour"
              onClick={() => router.back()}
            >
              <X className="h-8 w-8" strokeWidth={2.25} />
            </button>
            <ExchangeWalletPill
              membershipLabel={membershipLabel}
              availablePoints={availablePoints}
              activeCartCostPoints={activeCartCostPointsForUi}
              hasReachedLendingCap={hasReachedLendingCap}
              cartExceedsWallet={cartExceedsWallet}
              onWalletPanelOpenChange={setWalletPanelOpen}
              className="min-w-0 max-w-[min(100%,14.5rem)] shrink"
            />
          </div>
          <h1 className="mt-5 text-[28px] font-bold leading-[1.1] tracking-tight text-zinc-900">Panier</h1>
          <p className="mt-1.5 text-[18px] font-medium leading-snug text-zinc-600">{panierSubtitle}</p>
        </div>
      </header>

      {/* Réserve la place du header fixe (titre + sous-titre) ; aligné sur la colonne max-w phone. */}
      <div
        className="mx-auto h-[calc(env(safe-area-inset-top,0px)+10.25rem)] w-full max-w-[430px] shrink-0 bg-white"
        aria-hidden
      />

      <div className="flex flex-col pt-0">
        {/* Entre sections : gutter zinc 4.5px. En bas : réserve dock en blanc (pas de bande zinc comme avec padding-bottom transparent). */}
        <div className="flex flex-col space-y-[4.5px]">
        {/* Même logique qu’Exchange : lignes séparées par un trait fin (divide-y 1px) ; blocs séparés par le fond zinc-100 entre sections. */}
        <section className="bg-white px-5 py-4">
          {orderedLines.length === 0 ? (
            <div className="pb-2 pt-1">
              <p className="text-center text-sm font-medium text-zinc-600">Panier vide — ajoute des pièces depuis le shop.</p>
            </div>
          ) : null}

          {orderedLines.length > 0 ? (
            <>
              {lineRemoveError ? (
                <p className="mb-2 text-center text-[13px] font-medium leading-snug text-red-600">{lineRemoveError}</p>
              ) : null}
              <div className="-mx-5 divide-y-[1px] divide-zinc-200">
              {orderedLines.map((line) => {
                const surplus = isSurplusLine(line);
                const otherMembersHint = formatOtherMembersDiscreteLine(line.otherShoppersInCart ?? 0);
                const showCompetitionBlock = line.reservedByOther && !isGuest;
                return (
                <div key={line.id} className="relative">
                  {showCompetitionBlock ? (
                    <>
                      <div
                        className="pointer-events-auto absolute inset-0 z-[15] bg-zinc-900/38 backdrop-blur-md backdrop-saturate-125"
                        aria-hidden
                      />
                      <div className="pointer-events-none absolute inset-0 z-[16] flex flex-col items-center justify-center gap-1.5 px-6 text-center">
                        <CompetitionReservationCountdown expiresAt={line.reservedUntilAt ?? null} />
                        <p className="max-w-[16rem] text-[11px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
                          (Réservée par un membre Membre&nbsp;X)
                        </p>
                      </div>
                    </>
                  ) : null}
                  <article className="relative grid w-full grid-cols-[100px_minmax(0,50%)_auto] items-center gap-1 px-5 py-3">
                    <Link
                      href={`/items/${line.itemId}?from=cart`}
                      aria-label={`Voir ${line.itemName}`}
                      className={cn("absolute inset-0 z-0", showCompetitionBlock && "pointer-events-none")}
                    />

                    <div className="pointer-events-none relative z-10 flex items-center">
                      {line.photoUrl ? (
                        <RemoteCoverThumb
                          photoUrl={line.photoUrl}
                          photoPosition={line.photoPosition}
                          frameClassName="aspect-square w-[100px] shrink-0 rounded-md"
                        />
                      ) : (
                        <div className="flex aspect-square w-[100px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-200 text-zinc-400">
                          <ImageIcon className="h-7 w-7" aria-hidden />
                        </div>
                      )}
                    </div>

                    <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center justify-start px-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-[18px] font-semibold italic leading-[1.15] text-zinc-900 break-words">{line.itemName}</p>
                        {line.brand ? (
                          <span className="font-semibold text-[16px] not-italic text-zinc-900"> ({line.brand})</span>
                        ) : null}
                        {line.description ? (
                          <p
                            className="mt-1 min-w-0 text-[13px] leading-[1.3] text-zinc-500 line-clamp-1"
                            title={line.description}
                          >
                            {line.description}
                          </p>
                        ) : null}
                        <p
                          className={cn(
                            "mt-1 text-[15px] font-semibold tabular-nums tracking-tight",
                            surplus ? "text-red-600" : "text-zinc-900",
                          )}
                        >
                          {Math.floor(line.pricePoints).toLocaleString("fr-FR")} {balanceUnitLabel}
                        </p>
                        {!isGuest && otherMembersHint ? (
                          <p className="mt-0.5 text-[12px] italic leading-snug text-zinc-500">{otherMembersHint}</p>
                        ) : null}
                        {line.status !== "disponible" && !line.reservedByOther ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2 py-1 text-[11px] font-semibold",
                                CART_LINE_STATUS_CLASSNAMES[line.status],
                              )}
                            >
                              {cartLineStatusLabelFr(line.status)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="relative z-30 flex items-center justify-end gap-1 pr-0">
                      <button
                        type="button"
                        disabled={removingLineId === line.id}
                        className={cn(
                          "inline-flex h-9 w-9 items-center justify-center rounded-md disabled:opacity-50",
                          showCompetitionBlock
                            ? "bg-zinc-800/80 text-white ring-1 ring-zinc-900/20 cart-competition-trash-vibrate"
                            : surplus
                              ? "bg-red-50 text-red-600 cart-surplus-trash-vibrate"
                              : "bg-zinc-100 text-zinc-700",
                        )}
                        aria-label="Retirer du panier"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void removeLine(line.id);
                        }}
                      >
                        <Trash2 className="h-5 w-5" strokeWidth={2.2} />
                      </button>
                    </div>
                  </article>
                </div>
              );
              })}
              </div>
            </>
          ) : null}

          <div className="flex justify-end pt-4">
            <Link
              href="/shop"
              className="inline-flex h-10 w-fit items-center justify-center gap-1.5 rounded-full bg-zinc-100 px-4 text-[14px] font-bold text-zinc-900"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              <span>Ajouter des articles</span>
            </Link>
          </div>
        </section>

        <section className="bg-white px-5 py-4">
          <h2 className="text-[28px] font-bold leading-[1.1] tracking-tight text-zinc-900">Des offres pour vous</h2>
          <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto overflow-y-hidden pb-1 touch-pan-x px-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {OFFERS.map((offer) => (
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
                <span className="mt-3 inline-flex text-xs font-semibold text-[#5E3023]">Découvrir →</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="bg-white px-5 py-4">
          <h2 className="text-[28px] font-bold leading-[1.1] tracking-tight text-zinc-900">Échange</h2>

          <div className="mt-4">
            <div className="space-y-3">
            {cartExceedsWallet ? (
              <div className="relative space-y-2" role="status" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="text-[15px] font-semibold text-red-600">Crédits</span>
                    <button
                      type="button"
                      aria-expanded={exchangeCreditsInfoOpen}
                      aria-controls="cart-exchange-credits-info"
                      id="cart-exchange-credits-info-trigger"
                      aria-label="Informations sur les crédits manquants"
                      onClick={() => setExchangeCreditsInfoOpen((open) => !open)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-600 transition hover:bg-red-50"
                    >
                      <Info className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                  </div>
                  <span className="text-[15px] font-semibold tabular-nums text-red-600">
                    {euros(exchangeCreditsEuroCents / 100)}
                  </span>
                </div>
                {exchangeCreditsInfoOpen ? (
                  <div
                    id="cart-exchange-credits-info"
                    role="tooltip"
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-[13px] font-medium leading-snug text-zinc-950 shadow-sm"
                  >
                    <p>
                      Il manque{" "}
                      <span className="tabular-nums">{missingExchangeMods.toLocaleString("fr-FR")}</span>{" "}
                      {balanceUnitLabel} pour ce panier. Tarif : 1 {balanceUnitLabel} ={" "}
                      {(EXCHANGE_CREDIT_CENTS_PER_MOD / 100).toLocaleString("fr-FR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      € — montant déjà inclus dans le sous-total.
                    </p>
                    <p className="mt-2">
                      Tu peux acheter ces crédits au paiement, ou{" "}
                      <Link
                        href="/items/new"
                        className="text-zinc-950 underline underline-offset-2"
                      >
                        ajouter des pièces à l&apos;emprunt
                      </Link>{" "}
                      pour augmenter ton plafond.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
              <span
                className={cn(
                  "min-w-0 text-[15px] text-zinc-900",
                  insuranceOn ? "font-semibold" : "font-medium",
                )}
              >
                Protection commande
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "text-[15px] tabular-nums text-zinc-900",
                    insuranceOn ? "font-semibold" : "font-medium",
                  )}
                >
                  {euros(insuranceEuros)}
                </span>
                <input
                  type="checkbox"
                  checked={insuranceOn}
                  onChange={(e) => setInsuranceOn(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded border-[#C4A896] accent-[#5E3023] text-[#5E3023]"
                />
              </div>
            </label>
            </div>

            <div className="mt-6 w-full border-t border-zinc-200 pt-4">
              <div className="flex w-full items-baseline justify-between gap-3">
                <span className="text-[17px] font-extrabold leading-tight text-[#5E3023]">Sous-total</span>
                <span className="text-[17px] font-extrabold tabular-nums leading-tight text-[#5E3023]">
                  {euros(subtotalCashFees)}
                </span>
              </div>
            </div>
          </div>
        </section>
        </div>

        <div className="shrink-0 bg-white" style={{ height: scrollBottomPadding }} aria-hidden />
      </div>

      {walletPanelOpen ? null : (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
          <div className="pointer-events-auto w-full max-w-[430px] border-t border-zinc-200 bg-white shadow-[0_-12px_32px_rgba(0,0,0,0.08)] pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
            {showSubscriptionUpsell ? (
              <Link
                href={subscriptionUpsellHref}
                className="flex w-full items-start gap-3 border-b border-zinc-200 bg-white px-4 py-3.5 text-left transition active:bg-zinc-50"
              >
                <span
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[3px] border border-zinc-900 bg-white"
                  aria-hidden
                />
                <p className="min-w-0 text-[14px] leading-[1.4] text-zinc-900">
                  <span className="font-semibold text-amber-800">Économise sur les frais</span>
                  {" avec Segna+ — livraisons préférentielles et plafonds de prêt plus hauts."}
                </p>
              </Link>
            ) : null}

            <div className="px-4 pt-3">
            {orderedLines.length === 0 ? (
              <button
                type="button"
                className="flex h-12 w-full cursor-not-allowed items-center justify-center rounded-2xl bg-zinc-400 text-[15px] font-bold text-white"
                disabled
              >
                Réserver le panier
              </button>
            ) : cartStatus === "reserved" ? (
              hasReservedElsewhere && !isGuest ? (
                <p className="text-center text-[13px] font-medium leading-snug text-red-600">
                  Une pièce a été réservée par ailleurs — retire-la avant le paiement.
                </p>
              ) : (
                <Link
                  href="/cart/payment"
                  className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-[#5E3023] to-[#895737] text-[15px] font-bold text-white shadow-sm"
                >
                  Passer au paiement
                </Link>
              )
            ) : (
              <div className="w-full space-y-2">
                <button
                  type="button"
                  disabled={reserveBusy || !activeCartId || (!isGuest && hasReservedElsewhere)}
                  onClick={() => void goReserveThenPayment()}
                  className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-[#5E3023] to-[#895737] text-[15px] font-bold text-white shadow-sm disabled:opacity-60"
                >
                  {reserveBusy
                    ? isGuest
                      ? "Redirection…"
                      : "Réservation…"
                    : isGuest
                      ? "Passer au paiement"
                      : "Réserver le panier"}
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
    </div>
  );
}
