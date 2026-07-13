"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

import { ItemFeedbacksSection } from "./ItemFeedbacksSection";
import type { ItemInfoCardData } from "./ItemInfoCard";
import { ItemSizeConditionCard } from "./ItemSizeConditionCard";
import { ItemAddToCartCta } from "./ItemAddToCartCta";
import { ItemDetailAccordions } from "./ItemDetailAccordions";
import { SegnaPointsUnitDisplay } from "@/components/ui/SegnaPointsUnitDisplay";
import { ItemGuestPriceSelector } from "./ItemGuestPriceSelector";
import { ItemWornPhotosSection } from "./ItemWornPhotosSection";
import type { ItemFeedbackDisplayRow, ItemWornPhotoDisplayRow } from "@/lib/feedback/item-feedback-types";
import { ItemMemberSection } from "./ItemMemberSection";
import { ItemOutfitSection } from "./ItemOutfitSection";
import { ItemMoreCatalogSection } from "./ItemMoreCatalogSection";
import { ItemStyleLooksSection } from "./ItemStyleLooksSection";
import type { ItemStyleLookSummary } from "@/lib/items/fetch-item-style-looks";
import { ItemPhotoGallery } from "./ItemPhotoGallery";
import { ItemPhotoStickyHeader, type ItemPhotoStickyHeaderProps } from "./ItemPhotoOverlayActions";
import { useItemMemberData } from "@/hooks/useItemMemberData";
import type { ItemPhotoLayout } from "@/lib/items/item-photo-layout";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { ItemOutfitLookPayload } from "@/lib/items/fetch-item-outfit-look";
import { isSegnaCorporateInventoryUserId } from "@/lib/config/segna-corporate-inventory";
import { cn } from "@/lib/utils/cn";

export type ItemViewSlot = {
  dataUrl: string;
  offset: { x: number; y: number };
  zoom: number;
};

type ItemViewViewProps = {
  title: string;
  description?: string;
  slots: Array<ItemViewSlot | null>;
  photosLayout?: ItemPhotoLayout;
  infoCard: ItemInfoCardData;
  ownerUserId?: string | null;
  itemFeedbacks?: ItemFeedbackDisplayRow[];
  wornPhotos?: ItemWornPhotoDisplayRow[];
  outfitLook?: ItemOutfitLookPayload | null;
  outfitCompanionItems?: ShopCatalogItem[];
  outfitCompanionCoverUrlById?: Record<string, string>;
  styleLooks?: ItemStyleLookSummary[];
  moreCatalogItems?: ShopCatalogItem[];
  moreCatalogCoverUrlById?: Record<string, string>;
  guestCashRental?: boolean;
  stickyHeader?: Omit<ItemPhotoStickyHeaderProps, "solid"> | null;
  photoOverlay?: ReactNode;
  afterGallery?: ReactNode;
  showCartCta?: boolean;
  isInCart?: boolean;
  cartCtaBusy?: boolean;
  onToggleCart?: () => void;
};

function normalizeItemPhotoSlots(slots: Array<ItemViewSlot | null>): ItemViewSlot[] {
  return slots.filter((slot): slot is ItemViewSlot => slot != null && slot.dataUrl.trim().length > 0);
}

export function ItemViewView({
  title,
  description,
  slots,
  photosLayout = "portrait",
  infoCard,
  ownerUserId,
  itemFeedbacks = [],
  wornPhotos = [],
  outfitLook = null,
  outfitCompanionItems = [],
  outfitCompanionCoverUrlById = {},
  styleLooks = [],
  moreCatalogItems = [],
  moreCatalogCoverUrlById = {},
  guestCashRental = false,
  stickyHeader = null,
  photoOverlay,
  afterGallery,
  showCartCta = false,
  isInCart = false,
  cartCtaBusy = false,
  onToggleCart,
}: ItemViewViewProps) {
  const photos = normalizeItemPhotoSlots(slots);
  const isSegnaStockOwner = isSegnaCorporateInventoryUserId(ownerUserId);
  const brandLabel = infoCard.brand?.trim();
  const showBrand = Boolean(brandLabel && brandLabel !== "-");
  const { data: memberData, isLoading: memberLoading } = useItemMemberData(isSegnaStockOwner ? null : ownerUserId ?? null);
  const gallerySentinelRef = useRef<HTMLDivElement | null>(null);
  const [headerSolid, setHeaderSolid] = useState(false);

  useEffect(() => {
    if (!stickyHeader) return;
    const sentinel = gallerySentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeaderSolid(!entry.isIntersecting);
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [stickyHeader, photos.length]);

  return (
    <div className="pb-2">
      {stickyHeader ? <ItemPhotoStickyHeader {...stickyHeader} title={title} solid={headerSolid} /> : null}
      <div className="space-y-[4.5px] bg-zinc-100">
        <div className="bg-white">
          <ItemPhotoGallery
            photos={photos}
            photosLayout={photosLayout}
            loading={photos.length === 0}
            overlay={photoOverlay}
          />
          <div ref={gallerySentinelRef} className="h-0 w-full" aria-hidden />

          {afterGallery ? afterGallery : null}

          <div className="space-y-4 px-6 pt-4 pb-4">
            <div className="space-y-1.5">
              <div className="space-y-0.5">
                <h2
                  className={cn(
                    playfairDisplay.className,
                    "text-[24px] font-extrabold uppercase leading-tight tracking-tight text-zinc-900",
                  )}
                >
                  {title}
                </h2>
                {showBrand ? (
                  <p className={cn(montserrat.className, "text-[14px] font-medium text-zinc-500")}>{brandLabel}</p>
                ) : null}
              </div>
              {guestCashRental ? (
                <ItemGuestPriceSelector pricePoints={infoCard.pricePoints} />
              ) : (
                <div className={cn(montserrat.className, "text-[18px] font-bold text-zinc-900")}>
                  {infoCard.pricePoints != null ? (
                    <SegnaPointsUnitDisplay
                      points={infoCard.pricePoints}
                      creditKind="consumption"
                      unitDisplay="icon"
                      className="gap-x-1.5"
                      numberClassName={cn(montserrat.className, "text-[18px] font-bold text-zinc-900")}
                    />
                  ) : (
                    "En cours d’évaluation"
                  )}
                </div>
              )}
            </div>

            {!isSegnaStockOwner ? (
              <ItemMemberSection
                data={memberData}
                isLoading={memberLoading}
                profileHref={ownerUserId ? `/membre/${ownerUserId}` : null}
              />
            ) : null}

            <div className="space-y-3">
              <ItemSizeConditionCard
                data={{
                  labelSize: infoCard.size,
                  condition: infoCard.condition,
                  recommendedSize: infoCard.recommendedSize ?? "—",
                  sizeDescription: infoCard.sizeDescription,
                  categoryLabel: infoCard.categoryLabel,
                }}
              />

              {showCartCta ? (
                <ItemAddToCartCta
                  inCart={isInCart}
                  busy={cartCtaBusy}
                  onClick={onToggleCart}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="bg-white">
          <ItemDetailAccordions description={description} infoCard={infoCard} className="px-6" />

          {styleLooks.length > 0 ? <ItemStyleLooksSection looks={styleLooks} /> : null}
        </div>

        {moreCatalogItems.length > 0 ? (
          <div className="bg-white">
            <ItemMoreCatalogSection
              items={moreCatalogItems}
              initialCoverUrlById={moreCatalogCoverUrlById}
            />
          </div>
        ) : null}

        {(outfitLook && outfitCompanionItems.length > 0) || itemFeedbacks.length > 0 || wornPhotos.length > 0 ? (
          <div className="space-y-4 bg-white px-6 py-4">
            {outfitLook && outfitCompanionItems.length > 0 ? (
              <ItemOutfitSection
                outfit={outfitLook}
                companionItems={outfitCompanionItems}
                initialCoverUrlById={outfitCompanionCoverUrlById}
                guestCashRental={guestCashRental}
              />
            ) : null}

            <ItemFeedbacksSection feedbacks={itemFeedbacks} />
            <ItemWornPhotosSection photos={wornPhotos} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
