"use client";

import Link from "next/link";
import { ChevronLeft, MoreVertical, ShoppingCart } from "lucide-react";
import type { ReactNode } from "react";

import {
  CatalogPieceCardActionButtons,
  CATALOG_PIECE_LIKE_BTN_CLASS,
} from "@/components/shop/CatalogPieceCardActionButtons";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const playfairDisplay = segnaPlayfairDisplay;

export type ItemPhotoStickyHeaderProps = {
  onBack: () => void;
  title?: string;
  showCartNav?: boolean;
  ownerMenu?: ReactNode;
  /** Icônes blanches sur la photo (looks). Repasse en noir une fois le header opaque. */
  iconTone?: "dark" | "light";
  /** Fond blanc une fois la photo défilée. */
  solid?: boolean;
  className?: string;
};

export function ItemPhotoStickyHeader({
  onBack,
  title,
  showCartNav = true,
  ownerMenu,
  iconTone = "dark",
  solid = false,
  className,
}: ItemPhotoStickyHeaderProps) {
  const showTitle = solid && Boolean(title?.trim());
  const iconClass = solid || iconTone === "dark" ? "text-zinc-900" : "text-white";

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[60] px-4 pb-2 pt-[max(env(safe-area-inset-top,0px),12px)] transition-colors duration-200",
        solid ? "bg-white shadow-[0_1px_0_rgba(0,0,0,0.06)]" : "bg-transparent",
        className,
      )}
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-[430px] items-center gap-1">
        <div className="flex w-9 shrink-0 items-center justify-start">
          <button
            type="button"
            onClick={onBack}
            className={cn("-ml-1 p-1", iconClass)}
            aria-label="Retour"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2.2} />
          </button>
        </div>

        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden transition-opacity duration-200",
            showTitle ? "opacity-100" : "opacity-0",
          )}
          aria-hidden={!showTitle}
        >
          <p
            className={cn(
              playfairDisplay.className,
              "truncate text-center text-[15px] font-extrabold uppercase leading-none tracking-tight text-zinc-900",
            )}
          >
            {title}
          </p>
        </div>

        <div className="flex w-9 shrink-0 items-center justify-end gap-1.5">
          {showCartNav && !ownerMenu ? (
            <Link
              href="/cart"
              aria-label="Voir le panier"
              className={cn("relative p-1", iconClass)}
            >
              <ShoppingCart className="h-5 w-5" strokeWidth={2.2} aria-hidden />
            </Link>
          ) : null}
          {ownerMenu}
        </div>
      </div>
    </div>
  );
}

type ItemPhotoBottomActionsProps = {
  showLike?: boolean;
  isLiked?: boolean;
  likeBusy?: boolean;
  onToggleLike?: () => void;
  showCart?: boolean;
  isInCart?: boolean;
  cartBusy?: boolean;
  onToggleCart?: () => void;
};

export function ItemPhotoBottomActions({
  showLike = false,
  isLiked = false,
  likeBusy = false,
  onToggleLike,
  showCart = false,
  isInCart = false,
  cartBusy = false,
  onToggleCart,
}: ItemPhotoBottomActionsProps) {
  if (!showLike && !showCart) return null;

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-20">
      <CatalogPieceCardActionButtons
        className="pointer-events-auto"
        itemOverlay
        showLike={showLike}
        liked={isLiked}
        likeBusy={likeBusy}
        onToggleLike={onToggleLike}
        showCart={showCart}
        inCart={isInCart}
        cartBusy={cartBusy}
        onToggleCart={onToggleCart}
      />
    </div>
  );
}

/** @deprecated Préférer ItemPhotoStickyHeader + ItemPhotoBottomActions */
export function ItemPhotoOverlayActions({
  onBack,
  showCartNav = true,
  showLike = false,
  isLiked = false,
  likeBusy = false,
  onToggleLike,
  showCart = false,
  isInCart = false,
  cartBusy = false,
  onToggleCart,
  ownerMenu,
}: ItemPhotoStickyHeaderProps & ItemPhotoBottomActionsProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[max(env(safe-area-inset-top,0px),12px)]">
        <div className="pointer-events-auto mx-auto flex w-full max-w-[430px] items-center justify-between">
          <button type="button" onClick={onBack} className="-ml-1 p-1 text-zinc-900" aria-label="Retour">
            <ChevronLeft className="h-7 w-7" strokeWidth={2.2} />
          </button>
          <div className="flex items-center gap-1.5">
            {showCartNav && !ownerMenu ? (
              <Link href="/cart" className="relative p-1 text-zinc-900" aria-label="Voir le panier">
                <ShoppingCart className="h-5 w-5" strokeWidth={2.2} aria-hidden />
              </Link>
            ) : null}
            {ownerMenu}
          </div>
        </div>
      </div>
      <ItemPhotoBottomActions
        showLike={showLike}
        isLiked={isLiked}
        likeBusy={likeBusy}
        onToggleLike={onToggleLike}
        showCart={showCart}
        isInCart={isInCart}
        cartBusy={cartBusy}
        onToggleCart={onToggleCart}
      />
    </>
  );
}

export function ItemPhotoOwnerMenuButton({
  open,
  onToggle,
  menu,
  menuRef,
}: {
  open: boolean;
  onToggle: () => void;
  menu: ReactNode;
  menuRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity",
          CATALOG_PIECE_LIKE_BTN_CLASS,
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Actions sur la pièce"
      >
        <MoreVertical className="h-4 w-4" strokeWidth={2.2} />
      </button>
      {menu}
    </div>
  );
}
