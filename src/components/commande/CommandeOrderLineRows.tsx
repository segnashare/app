"use client";

import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";

import type { MemberCartOrderLine } from "@/lib/cart/fetch-member-cart-order-detail";
import { cartLineDisplayTitleWithoutBrand } from "@/lib/cart/cart-line-display-title";
import type { WalletCreditKind } from "@/lib/wallet/credit-kind";
import {
  ITEM_LIST_SQUARE_THUMB_FRAME_CLASS,
  itemSquareListThumbCoverProps,
} from "@/lib/items/item-photo-layout";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { ItemCatalogModePriceDisplay } from "@/components/ui/ItemCatalogModePriceDisplay";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import {
  BORROW_CHECKOUT_OPTIONS_FALLBACK,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";

/** Lignes affichables comme sur le détail commande (panier checkout inclus). */
export type CommandeStyleOrderLine = Pick<
  MemberCartOrderLine,
  "id" | "itemId" | "itemName" | "brand" | "description" | "sizeLabel" | "pricePoints" | "photoUrl" | "photoPosition"
>;

type CommandeOrderLineRowsProps = {
  lines: CommandeStyleOrderLine[];
  creditKind: WalletCreditKind;
  /** Suffixe URL fiche article, ex. `?from=commande` ou chaîne vide. */
  itemHrefSuffix?: string;
  /** `icon` : montant + picto Segna (détail commande / emprunt / paiement). */
  pointsUnitDisplay?: "label" | "icon";
  /** Guest location € : prix selon le mode catalogue (session). */
  guestCashRental?: boolean;
  /** Guest achat € : prix fixe par pièce (pas de / semaine). */
  guestPurchaseMode?: boolean;
  borrowCheckoutOptions?: BorrowCheckoutOption[];
};

/**
 * Même grille que le panier (vignette + texte), sans corbeille : le coût en points à droite.
 */
export function CommandeOrderLineRows({
  lines,
  creditKind,
  itemHrefSuffix = "?from=commande",
  pointsUnitDisplay = "label",
  guestCashRental = false,
  guestPurchaseMode = false,
  borrowCheckoutOptions = BORROW_CHECKOUT_OPTIONS_FALLBACK,
}: CommandeOrderLineRowsProps) {
  if (lines.length === 0) return null;

  return (
    <div className="-mx-5 divide-y divide-zinc-200">
      {lines.map((line) => {
        const title = cartLineDisplayTitleWithoutBrand(line.itemName, line.brand);
        const sizeLine = line.sizeLabel?.trim() || null;
        return (
          <article
            key={line.id}
            className="relative grid w-full grid-cols-[100px_minmax(0,1fr)_auto] items-center gap-1 px-5 pb-3 pt-3 first:pt-1.5"
          >
            <Link
              href={`/items/${line.itemId}${itemHrefSuffix}`}
              aria-label={`Voir ${title}`}
              className="absolute inset-0 z-0"
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
                  className={`flex items-center justify-center overflow-hidden rounded-md bg-zinc-200 text-zinc-400 ${ITEM_LIST_SQUARE_THUMB_FRAME_CLASS}`}
                >
                  <ImageIcon className="h-7 w-7" aria-hidden />
                </div>
              )}
            </div>

            <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center justify-start px-1">
              <div className="min-w-0 flex-1">
                <p className="break-words text-[18px] font-semibold italic leading-[1.15] text-zinc-900">
                  {title}
                </p>
                {sizeLine ? (
                  <p className="mt-1 text-[13px] leading-[1.3] text-zinc-500">Taille {sizeLine}</p>
                ) : null}
              </div>
            </div>

            <div className="relative z-10 flex items-center justify-end self-stretch pl-1">
              <p className="pointer-events-none text-right tracking-tight text-zinc-900">
                {guestCashRental ? (
                  <ItemCatalogModePriceDisplay
                    pricePoints={line.pricePoints}
                    borrowCheckoutOptions={borrowCheckoutOptions}
                    guestCashRental
                    forcedMode={guestPurchaseMode ? "achat" : undefined}
                    priceClassName="text-[15px] font-semibold text-zinc-900"
                  />
                ) : (
                  <SegnaPointsUnitDisplay
                    points={line.pricePoints}
                    creditKind={creditKind}
                    unitDisplay={pointsUnitDisplay}
                    numberClassName="text-[15px] font-semibold text-zinc-900"
                  />
                )}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
