"use client";

import { Heart, Plus } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export const CATALOG_PIECE_LIKE_BTN_CLASS =
  "bg-white/95 text-zinc-900 shadow-sm ring-1 ring-black/10 backdrop-blur-[2px]";

export function catalogPieceCartBtnClass(inCart: boolean): string {
  return inCart
    ? "bg-zinc-950 text-white shadow-sm ring-1 ring-black/20"
    : CATALOG_PIECE_LIKE_BTN_CLASS;
}

type CatalogPieceCardActionButtonsProps = {
  liked?: boolean;
  likeBusy?: boolean;
  onToggleLike?: () => void;
  showLike?: boolean;
  showCart?: boolean;
  inCart?: boolean;
  cartBusy?: boolean;
  onToggleCart?: () => void;
  /** Cartes compactes du catalogue (~30 % plus petites). */
  compact?: boolean;
  /** Fiche produit : boutons photo légèrement plus grands. */
  itemOverlay?: boolean;
  className?: string;
};

export function CatalogPieceCardActionButtons({
  liked = false,
  likeBusy = false,
  onToggleLike,
  showLike = true,
  showCart = false,
  inCart = false,
  cartBusy = false,
  onToggleCart,
  compact = false,
  itemOverlay = false,
  className,
}: CatalogPieceCardActionButtonsProps) {
  const sizeClass = compact ? "h-7 w-7" : itemOverlay ? "h-10 w-10" : "h-9 w-9";
  const iconClass = compact ? "h-3.5 w-3.5" : itemOverlay ? "h-5 w-5" : "h-4 w-4";

  return (
    <div className={cn("flex gap-1.5", className)}>
      {showLike ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleLike?.();
          }}
          disabled={likeBusy}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-50",
            sizeClass,
            CATALOG_PIECE_LIKE_BTN_CLASS,
          )}
          title="Ajouter aux favoris"
          aria-label={liked ? "Retirer des coups de cœur" : "Ajouter aux coups de cœur"}
        >
          <Heart className={cn(iconClass, liked && "fill-current")} aria-hidden />
        </button>
      ) : null}

      {showCart ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleCart?.();
          }}
          disabled={cartBusy}
          className={cn(
            "segna-guidance-shimmer-target inline-flex shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-50",
            sizeClass,
            catalogPieceCartBtnClass(inCart),
          )}
          title={inCart ? "Retirer du panier" : "Ajouter au panier"}
          aria-label={inCart ? "Retirer du panier" : "Ajouter au panier"}
        >
          <Plus
            className={cn(iconClass, "transition-transform duration-200", inCart && "rotate-45")}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  );
}
