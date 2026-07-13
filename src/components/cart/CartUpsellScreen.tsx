"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { ItemCatalogModePriceDisplay } from "@/components/ui/ItemCatalogModePriceDisplay";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { useToggleCartItem } from "@/hooks/useToggleCartItem";
import {
  computeItemRentalEuroCents,
  formatEuroPerCredit,
  type BorrowCheckoutOption,
} from "@/lib/billing/fetch-borrow-checkout-options";
import { isGuestCashRentalMode } from "@/lib/billing/guest-rental-pricing";
import { CartCatalogModeProvider } from "@/components/cart/CartCatalogModeContext";
import {
  readCheckoutBorrowDurationDays,
  resolveCheckoutBorrowDurationDays,
} from "@/lib/cart/checkout-borrow-duration-storage";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type CartUpsellScreenProps = {
  title?: string;
  skipHref?: string;
  backHref?: string;
  items: ShopCatalogItem[];
  initialCoverUrlById?: Record<string, string>;
  /** Afficher les pièces déjà au panier (bouton ×). */
  allowInCartItems?: boolean;
  borrowCheckoutOptions: BorrowCheckoutOption[];
  membershipLabel?: "Guest" | "Membre +" | "Membre X";
};

function upsellCardSizeLine(sizeLabel: string | null | undefined): string {
  const t = sizeLabel?.trim();
  return t ? `Taille ${t}` : "Taille unique";
}

function UpsellGridCard({
  item,
  cover,
  inCart,
  busy,
  onToggleCart,
  allowInCartItems = false,
  borrowDurationDays,
  borrowCheckoutOptions,
  guestCashRental = false,
}: {
  item: ShopCatalogItem;
  cover?: string;
  inCart: boolean;
  busy: boolean;
  onToggleCart: () => void;
  allowInCartItems?: boolean;
  borrowDurationDays: number;
  borrowCheckoutOptions: BorrowCheckoutOption[];
  guestCashRental?: boolean;
}) {
  const canAdd = allowInCartItems
    ? item.status === "available" || item.status === "in_cart"
    : item.status === "available";
  const brandName = (item.brand_label ?? "").trim();
  const sizeLine = upsellCardSizeLine(item.size_label);
  const rentalEuroCents = computeItemRentalEuroCents(
    item.price_points,
    borrowDurationDays,
    borrowCheckoutOptions,
  );
  const rentalEuroLabel = rentalEuroCents > 0 ? formatEuroPerCredit(rentalEuroCents) : null;

  return (
    <article className="min-w-0">
      <Link href={`/items/${item.id}?from=cart`} className="block">
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-zinc-100 ring-1 ring-black/[0.06]">
          {cover ? (
            <RemoteCoverThumb
              photoUrl={cover}
              frameClassName="absolute inset-0 h-full w-full"
              className="h-full w-full"
              coverStyle={{
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
              }}
            />
          ) : (
            <div className="h-full w-full bg-zinc-200" aria-hidden />
          )}
          {canAdd ? (
            <button
              type="button"
              aria-label={inCart ? "Retirer du panier" : "Ajouter au panier"}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleCart();
              }}
              className={cn(
                "absolute bottom-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full shadow-sm ring-1 transition active:scale-[0.98] disabled:opacity-50",
                inCart
                  ? "bg-zinc-950 text-white ring-black/20"
                  : "bg-white/95 text-zinc-900 ring-black/10 backdrop-blur-[2px]",
              )}
            >
              <Plus className={cn("h-4 w-4 transition-transform duration-200", inCart && "rotate-45")} aria-hidden />
            </button>
          ) : null}
        </div>
      </Link>
      <div className="mt-2 min-w-0 flex flex-col gap-0.5 px-0.5">
        <p
          className={cn(
            segnaMontserrat.className,
            "line-clamp-2 text-left text-[14px] font-bold leading-snug text-zinc-900",
          )}
        >
          {item.title}
        </p>
        {(brandName || sizeLine) ? (
          <p
            className={cn(
              segnaMontserrat.className,
              "flex min-w-0 flex-wrap items-center gap-x-1 text-left text-[13px] leading-snug text-zinc-600",
            )}
          >
            {brandName ? (
              <>
                <span className="min-w-0 truncate italic">{brandName}</span>
                <span className="shrink-0 text-zinc-400" aria-hidden>
                  |
                </span>
              </>
            ) : null}
            <span className="shrink-0 font-medium">{sizeLine}</span>
          </p>
        ) : null}
        <p
          className={cn(
            segnaMontserrat.className,
            "flex flex-wrap items-center gap-x-1 text-left text-[11px] font-medium leading-snug text-zinc-600",
          )}
        >
          {typeof item.price_points === "number" && !Number.isNaN(item.price_points) ? (
            guestCashRental ? (
              <ItemCatalogModePriceDisplay
                pricePoints={item.price_points}
                borrowCheckoutOptions={borrowCheckoutOptions}
                priceClassName={cn(segnaMontserrat.className, "font-semibold text-zinc-900")}
              />
            ) : (
              <>
                <SegnaPointsUnitDisplay
                  points={item.price_points}
                  creditKind="consumption"
                  unitDisplay="icon"
                  iconColor="fixed"
                  className="shrink-0 gap-x-0.5"
                  numberClassName={cn(segnaMontserrat.className, "tabular-nums")}
                />
                {rentalEuroLabel ? (
                  <>
                    <span className="shrink-0 text-zinc-400" aria-hidden>
                      |
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-600">
                      {rentalEuroLabel}{" "}
                      <span className="text-zinc-500">({borrowDurationDays}j)</span>
                    </span>
                  </>
                ) : null}
              </>
            )
          ) : (
            <span className={cn(segnaMontserrat.className, "tabular-nums text-zinc-500")}>—</span>
          )}
        </p>
      </div>
    </article>
  );
}

export function CartUpsellScreen(props: CartUpsellScreenProps) {
  return (
    <CartCatalogModeProvider>
      <CartUpsellScreenContent {...props} />
    </CartCatalogModeProvider>
  );
}

function CartUpsellScreenContent({
  title = "Terminez votre commande",
  skipHref = "/cart/payment",
  backHref = "/cart",
  items,
  initialCoverUrlById = {},
  allowInCartItems = false,
  borrowCheckoutOptions,
  membershipLabel = "Guest",
}: CartUpsellScreenProps) {
  const guestCashRental = isGuestCashRentalMode(membershipLabel);
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { cartItemIds, cartBusyIds, toggleCart } = useToggleCartItem();
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>(initialCoverUrlById);
  const [borrowDurationDays, setBorrowDurationDays] = useState(() =>
    resolveCheckoutBorrowDurationDays(readCheckoutBorrowDurationDays(), borrowCheckoutOptions),
  );

  useEffect(() => {
    const syncDuration = () => {
      setBorrowDurationDays(
        resolveCheckoutBorrowDurationDays(readCheckoutBorrowDurationDays(), borrowCheckoutOptions),
      );
    };
    syncDuration();
    window.addEventListener("focus", syncDuration);
    window.addEventListener("pageshow", syncDuration);
    return () => {
      window.removeEventListener("focus", syncDuration);
      window.removeEventListener("pageshow", syncDuration);
    };
  }, [borrowCheckoutOptions]);

  const visibleItems = useMemo(() => {
    const base = allowInCartItems
      ? items.filter((item) => item.status === "available" || item.status === "in_cart")
      : items.filter((item) => item.status === "available");
    return base.slice(0, 10);
  }, [allowInCartItems, items]);

  const hasAddedFromSuggestions = useMemo(
    () => visibleItems.some((item) => cartItemIds.has(item.id)),
    [cartItemIds, visibleItems],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pathByItemId = new Map<string, string>();
      for (const item of visibleItems) {
        if (coverUrlById[item.id]) continue;
        const path = getFirstPhotoStoragePath(item.photos);
        if (!path) continue;
        pathByItemId.set(item.id, path);
      }
      if (pathByItemId.size === 0) return;
      const signedByPath = await createSignedUrlsForStoragePaths(supabase, [...pathByItemId.values()], 60 * 60 * 24);
      if (cancelled) return;
      const updates: Record<string, string> = {};
      for (const [id, path] of pathByItemId) {
        const url = signedByPath.get(path);
        if (url) updates[id] = url;
      }
      if (Object.keys(updates).length > 0) {
        setCoverUrlById((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coverUrlById, supabase, visibleItems]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white">
      <header className="shrink-0 px-4 pb-4 pt-[max(env(safe-area-inset-top,0px),12px)]">
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-900"
          aria-label="Retour au panier"
        >
          <ArrowLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <h1
          className={cn(
            segnaPlayfairDisplay.className,
            "mt-1 text-[24px] font-bold leading-[1.05] tracking-tight text-zinc-950",
          )}
        >
          {title}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-2">
        <div className="grid grid-cols-2 gap-x-3 gap-y-5">
          {visibleItems.map((item) => (
            <UpsellGridCard
              key={item.id}
              item={item}
              cover={coverUrlById[item.id]}
              inCart={cartItemIds.has(item.id)}
              busy={cartBusyIds.has(item.id)}
              onToggleCart={() => void toggleCart(item.id)}
              allowInCartItems={allowInCartItems}
              borrowDurationDays={borrowDurationDays}
              borrowCheckoutOptions={borrowCheckoutOptions}
              guestCashRental={guestCashRental}
            />
          ))}
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
        <div className="pointer-events-auto w-full max-w-[430px] bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-3">
          <button
            type="button"
            onClick={() => router.push(skipHref)}
            className="flex h-12 w-full items-center justify-center rounded-full bg-zinc-950 text-[15px] font-bold text-white shadow-sm transition active:bg-zinc-800"
          >
            {hasAddedFromSuggestions ? "Continuer" : "Non merci"}
          </button>
        </div>
      </div>
    </div>
  );
}
