"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Image as ImageIcon, Plus, Trash2 } from "lucide-react";

import { CART_LINE_STATUS_CLASSNAMES, type CartLineStatus } from "@/lib/cart/cart-line-status";
import {
  ITEM_LIST_SQUARE_THUMB_FRAME_CLASS,
  itemSquareListThumbCoverProps,
} from "@/lib/items/item-photo-layout";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { formatOtherMembersDiscreteLine } from "@/lib/cart/cart-competition-copy";
import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import { ItemCatalogModePriceDisplay } from "@/components/ui/ItemCatalogModePriceDisplay";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import type { BorrowCheckoutOption } from "@/lib/billing/fetch-borrow-checkout-options";
import { BORROW_CHECKOUT_OPTIONS_FALLBACK } from "@/lib/billing/fetch-borrow-checkout-options";
import { isGuestCashRentalMode } from "@/lib/billing/guest-rental-pricing";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { cn } from "@/lib/utils/cn";

function cartLineStatusLabelFr(status: CartLineStatus): string {
  if (status === "disponible") return "Disponible";
  if (status === "reserve") return "Réservé";
  if (status === "en_attente_wallet") return "Non réservé";
  return "À vérifier";
}

function cartLineDisplayTitle(itemName: string, brand: string | null): string {
  const trimmed = itemName.trim();
  if (!brand) return trimmed;
  const suffix = `(${brand.trim()})`;
  if (trimmed.endsWith(suffix)) {
    return trimmed.slice(0, -suffix.length).trim();
  }
  return trimmed;
}

function parseCompetitionExpiryMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withT = /^\d{4}-\d{2}-\d{2}[ T]\d/.test(trimmed) ? trimmed.replace(" ", "T") : trimmed;
  const ms = Date.parse(withT);
  return Number.isNaN(ms) ? null : ms;
}

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

export type CartPanierLineRowsProps = {
  lines: CartLineRowData[];
  membershipLabel: "Guest" | "Membre +" | "Membre X";
  availablePoints: number;
  borrowCheckoutOptions?: BorrowCheckoutOption[];
  removingLineId: string | null;
  lineRemoveError: string | null;
  onRemoveLine: (lineId: string) => void;
  /** Si false : pas de lien « Ajouter des articles » sous la liste (ex. aperçu). */
  showAddArticlesLink?: boolean;
  /** Page Échange : typo plus compacte. */
  exchangeUiCalm?: boolean;
  /** Onboarding panier : attire l'oeil vers l'ajout d'articles. */
  guideAddArticlesLink?: boolean;
  /** Page panier : masquer les pastilles « Réservé », etc. */
  hideLineStatusBadges?: boolean;
};

/**
 * Liste des lignes panier (grille vignette + titre + marque + description + points + corbeille),
 * identique à la section `cart_system_items` de {@link CartScreen}.
 */
export function CartPanierLineRows({
  lines,
  membershipLabel,
  availablePoints,
  borrowCheckoutOptions = BORROW_CHECKOUT_OPTIONS_FALLBACK,
  removingLineId,
  lineRemoveError,
  onRemoveLine,
  showAddArticlesLink = true,
  exchangeUiCalm = false,
  guideAddArticlesLink = false,
  hideLineStatusBadges = false,
}: CartPanierLineRowsProps) {
  const walletCreditKind = walletCreditKindForMembership(membershipLabel);
  const guestCashRental = isGuestCashRentalMode(membershipLabel);

  return (
    <>
      {lineRemoveError ? (
        <p
          className={cn(
            "mb-2 text-center text-[13px] font-medium leading-snug",
            exchangeUiCalm ? "text-zinc-700" : "text-red-600",
          )}
        >
          {lineRemoveError}
        </p>
      ) : null}
      {lines.length > 0 ? (
      <div className="-mx-5 divide-y-[1px] divide-zinc-200">
        {lines.map((line) => {
          const otherMembersHint = formatOtherMembersDiscreteLine(line.otherShoppersInCart ?? 0);
          const showCompetitionBlock = line.reservedByOther;
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
              <article
                className={cn(
                  "relative grid w-full items-center gap-1 px-5",
                  "grid-cols-[100px_minmax(0,50%)_auto]",
                  exchangeUiCalm ? "py-2" : "py-3",
                )}
              >
                <Link
                  href={`/items/${line.itemId}?from=cart`}
                  aria-label={`Voir ${line.itemName}`}
                  className={cn("absolute inset-0 z-0", showCompetitionBlock && "pointer-events-none")}
                />

                <div className="pointer-events-none relative z-10 flex items-center">
                  {line.photoUrl ? (
                    <RemoteCoverThumb
                      photoUrl={line.photoUrl}
                      frameClassName={ITEM_LIST_SQUARE_THUMB_FRAME_CLASS}
                      {...itemSquareListThumbCoverProps({ photoPosition: line.photoPosition })}
                    />
                  ) : (
                    <div
                      className={cn(
                        "flex items-center justify-center overflow-hidden rounded-md bg-zinc-200 text-zinc-400",
                        ITEM_LIST_SQUARE_THUMB_FRAME_CLASS,
                      )}
                    >
                      <ImageIcon className="h-7 w-7" aria-hidden />
                    </div>
                  )}
                </div>

                <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center justify-start px-1">
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-semibold italic text-zinc-900 break-words", exchangeUiCalm ? "text-[16px] leading-[1.08]" : "text-[18px] leading-[1.15]")}>
                      {cartLineDisplayTitle(line.itemName, line.brand)}
                    </p>
                    {line.brand ? (
                      <p
                        className={cn("mt-0.5 min-w-0 italic text-zinc-500 line-clamp-1", exchangeUiCalm ? "text-[12px] leading-[1.2]" : "text-[13px] leading-[1.3]")}
                        title={line.brand}
                      >
                        {line.brand}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[15px] tracking-tight text-zinc-900">
                      {guestCashRental ? (
                        <ItemCatalogModePriceDisplay
                          pricePoints={line.pricePoints}
                          borrowCheckoutOptions={borrowCheckoutOptions}
                          guestCashRental
                          priceClassName="text-[15px] font-semibold text-zinc-900"
                        />
                      ) : (
                        <SegnaPointsUnitDisplay
                          points={line.pricePoints}
                          creditKind={walletCreditKind}
                          numberClassName="text-[15px] font-semibold tabular-nums text-zinc-900"
                        />
                      )}
                    </p>
                    {!guestCashRental && otherMembersHint ? (
                      <p className="mt-0.5 text-[12px] italic leading-snug text-zinc-500">{otherMembersHint}</p>
                    ) : null}
                    {!hideLineStatusBadges && line.status !== "disponible" && !line.reservedByOther ? (
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
                        ? "bg-zinc-800/80 text-white ring-1 ring-zinc-900/20"
                        : "bg-zinc-100 text-zinc-700",
                    )}
                    aria-label="Retirer du panier"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRemoveLine(line.id);
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
      ) : null}

      {showAddArticlesLink ? (
        <div className={cn("flex justify-end", exchangeUiCalm ? "pt-1" : "pt-4")}>
          <Link
            href="/shop"
            className={cn(
              "segna-guidance-shimmer-target inline-flex w-fit items-center justify-center gap-1.5 rounded-full bg-zinc-100 text-[14px] font-bold text-zinc-900",
              exchangeUiCalm ? "h-9 px-3" : "h-10 px-4",
              guideAddArticlesLink && "segna-guidance-shimmer-active",
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            <span>Ajouter des articles</span>
          </Link>
        </div>
      ) : null}
    </>
  );
}
