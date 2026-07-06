"use client";

import { useEffect, useState } from "react";
import { Heart, Plus } from "lucide-react";

import { ItemDescriptionCard } from "./ItemDescriptionCard";
import { ItemFeedbacksSection } from "./ItemFeedbacksSection";
import { ItemInfoCard } from "./ItemInfoCard";
import type { ItemInfoCardData } from "./ItemInfoCard";
import { ItemWornPhotosSection } from "./ItemWornPhotosSection";
import type { ItemFeedbackDisplayRow, ItemWornPhotoDisplayRow } from "@/lib/feedback/item-feedback-types";
import { ItemMemberSection } from "./ItemMemberSection";
import { ItemOutfitSection } from "./ItemOutfitSection";
import { ItemSegnaPropertyCmsSection } from "./ItemSegnaPropertyCmsSection";
import { useItemMemberData } from "@/hooks/useItemMemberData";
import { useSegnaStockPropertyCmsRows } from "@/hooks/useSegnaStockPropertyCmsRows";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { ItemOutfitLookPayload } from "@/lib/items/fetch-item-outfit-look";
import { isSegnaCorporateInventoryUserId } from "@/lib/config/segna-corporate-inventory";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";
import type { ItemPhotoLayout } from "@/lib/items/item-photo-layout";
import { itemPhotoDisplayAspectClass } from "@/lib/items/item-photo-layout";

/** photo1 : principale ; photo2–photo6 : autres vues produit (`items.photos`). */
const CATALOG_EXTRA_PHOTO_SLOT_INDICES = [1, 2, 3, 4, 5] as const;

function normalizeItemPhotoSlots(slots: Array<ItemViewSlot | null>): Array<ItemViewSlot | null> {
  const next = [...slots];
  while (next.length < 6) next.push(null);
  return next.slice(0, 6);
}

function FrameActionButton({
  variant = "heart",
  isActive,
  forceDark = false,
  onPress,
}: {
  variant?: "heart" | "plus";
  isActive: boolean;
  forceDark?: boolean;
  onPress: () => void;
}) {
  const isHeart = variant === "heart";
  return (
    <button
      type="button"
      aria-label={isHeart ? (isActive ? "Retirer le like" : "Liker cette frame") : "Ajouter au panier"}
      onClick={onPress}
      className={cn(
        "absolute bottom-4 right-4 z-10 grid h-14 w-14 place-items-center rounded-full shadow-lg ring-1 backdrop-blur-sm transition hover:scale-[1.02] active:scale-[0.98]",
        forceDark || isActive ? "bg-zinc-900 text-white ring-zinc-900/20" : "bg-white/95 text-zinc-900 ring-zinc-200",
      )}
    >
      {isHeart ? (
        <Heart className={cn("h-7 w-7", isActive && "fill-current")} strokeWidth={2.2} />
      ) : (
        <Plus className={cn("h-7 w-7 transition-transform duration-200", isActive && "rotate-45")} strokeWidth={2.2} />
      )}
    </button>
  );
}

export type ItemViewSlot = {
  dataUrl: string;
  offset: { x: number; y: number };
  zoom: number;
};

type ItemViewViewProps = {
  title: string;
  description: string;
  slots: Array<ItemViewSlot | null>;
  /** Orientation des photos catalogue (portrait 3:4 ou paysage 4:3). */
  photosLayout?: ItemPhotoLayout;
  infoCard: ItemInfoCardData;
  ownerUserId?: string | null;
  onLikeFrame?: () => void;
  onFrameAction?: () => void;
  frameActionVariant?: "heart" | "plus";
  frameActionActive?: boolean;
  forceDarkFrameAction?: boolean;
  /** Masque les boutons cœur / action sur les photos (true par défaut ; le feed passe false pour liker / panier). */
  hideFrameLikeButtons?: boolean;
  /**
   * Frames CMS section `segna_stock_property` (Propriété Segna). Si défini (ex. SSR fiche pièce), pas de chargement client.
   */
  segnaStockPropertyCmsFrames?: CmsFrameRow[];
  itemFeedbacks?: ItemFeedbackDisplayRow[];
  wornPhotos?: ItemWornPhotoDisplayRow[];
  /** Tenue CMS + pièces complémentaires résolues (fiche catalogue). */
  outfitLook?: ItemOutfitLookPayload | null;
  outfitCompanionItems?: ShopCatalogItem[];
  outfitCompanionCoverUrlById?: Record<string, string>;
  guestCashRental?: boolean;
};

function ItemViewCoverPhoto({
  slot,
  photosLayout,
  onImageRatio,
}: {
  slot: ItemViewSlot;
  photosLayout: ItemPhotoLayout;
  onImageRatio?: (ratio: number) => void;
}) {
  return (
    <RemoteCoverThumb
      photoUrl={slot.dataUrl}
      frameClassName={cn("h-full w-full")}
      photoPosition={{ offset: slot.offset, zoom: slot.zoom }}
      photoCoverFill
      photosLayout={photosLayout}
      onImageDimensions={(size) => {
        if (size.h > 0) onImageRatio?.(size.w / size.h);
      }}
    />
  );
}

function ItemViewPhotoFrame({
  slot,
  frameKey,
  photosLayout,
  showPlaceholder,
  hideFrameLikeButtons,
  frameActionVariant,
  frameActionActive,
  forceDarkFrameAction,
  likedFrames,
  onFrameAction,
  onLikeFrame,
  onToggleFrameLike,
}: {
  slot: ItemViewSlot | null;
  frameKey: string;
  photosLayout: ItemPhotoLayout;
  showPlaceholder?: boolean;
  hideFrameLikeButtons: boolean;
  frameActionVariant: "heart" | "plus";
  frameActionActive: boolean;
  forceDarkFrameAction: boolean;
  likedFrames: Record<string, boolean>;
  onFrameAction?: () => void;
  onLikeFrame?: () => void;
  onToggleFrameLike: (frameId: string) => void;
}) {
  const [imageRatio, setImageRatio] = useState<number | null>(null);
  const photoFrameClass = itemPhotoDisplayAspectClass(photosLayout, imageRatio);

  useEffect(() => {
    setImageRatio(null);
  }, [slot?.dataUrl]);

  if (!slot && !showPlaceholder) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200 shadow-sm">
      <div className={cn("relative w-full", photoFrameClass)}>
        {slot ? (
          <ItemViewCoverPhoto slot={slot} photosLayout={photosLayout} onImageRatio={setImageRatio} />
        ) : (
          <SegnaSkeletonBlock className="absolute inset-0 h-full w-full" rounded="rounded-2xl" />
        )}
      </div>
      {slot && !hideFrameLikeButtons ? (
        <FrameActionButton
          variant={frameActionVariant}
          isActive={frameActionVariant === "heart" ? Boolean(likedFrames[frameKey]) : frameActionActive}
          forceDark={forceDarkFrameAction}
          onPress={() => {
            if (onFrameAction) {
              onFrameAction();
              return;
            }
            if (onLikeFrame) {
              onLikeFrame();
              return;
            }
            onToggleFrameLike(frameKey);
          }}
        />
      ) : null}
    </div>
  );
}

export function ItemViewView({
  description,
  slots,
  photosLayout = "portrait",
  infoCard,
  ownerUserId,
  onLikeFrame,
  onFrameAction,
  frameActionVariant = "heart",
  frameActionActive = false,
  forceDarkFrameAction = false,
  hideFrameLikeButtons = true,
  segnaStockPropertyCmsFrames,
  itemFeedbacks = [],
  wornPhotos = [],
  outfitLook = null,
  outfitCompanionItems = [],
  outfitCompanionCoverUrlById = {},
  guestCashRental = false,
}: ItemViewViewProps) {
  const [likedFrames, setLikedFrames] = useState<Record<string, boolean>>({});
  const normalizedSlots = normalizeItemPhotoSlots(slots);
  const isSegnaStockOwner = isSegnaCorporateInventoryUserId(ownerUserId);
  const fetchSegnaCmsClient = isSegnaStockOwner && segnaStockPropertyCmsFrames === undefined;
  const { rows: clientSegnaCmsRows, loading: segnaCmsLoading } = useSegnaStockPropertyCmsRows(fetchSegnaCmsClient);
  const segnaCmsRows = segnaStockPropertyCmsFrames !== undefined ? segnaStockPropertyCmsFrames : clientSegnaCmsRows;
  const { data: memberData, isLoading: memberLoading } = useItemMemberData(isSegnaStockOwner ? null : ownerUserId ?? null);

  const catalogExtraPhotos = CATALOG_EXTRA_PHOTO_SLOT_INDICES.flatMap((slotIndex) => {
    const slot = normalizedSlots[slotIndex];
    return slot ? [{ slotIndex, slot }] : [];
  });

  function toggleFrameLike(frameId: string) {
    setLikedFrames((previous) => ({ ...previous, [frameId]: !previous[frameId] }));
  }

  const photoFrameProps = {
    photosLayout,
    hideFrameLikeButtons,
    frameActionVariant,
    frameActionActive,
    forceDarkFrameAction,
    likedFrames,
    onFrameAction,
    onLikeFrame,
    onToggleFrameLike: toggleFrameLike,
  };

  return (
    <div className="bg-white pb-2 pt-2">
      {/* 1. Photo principale (photo1) */}
      <div className="pb-2">
        <ItemViewPhotoFrame
          slot={normalizedSlots[0]}
          frameKey="photo_1"
          showPlaceholder={!normalizedSlots[0]}
          {...photoFrameProps}
        />
      </div>

      {/* 2. Infos */}
      <div className="pt-2">
        <ItemInfoCard data={infoCard} guestCashRental={guestCashRental} />
      </div>

      <div className="space-y-4 pt-4">
        {/* 3. Propriétaire */}
        {isSegnaStockOwner ? (
          <ItemSegnaPropertyCmsSection
            cmsRows={segnaCmsRows}
            loadingClientCms={fetchSegnaCmsClient && segnaCmsLoading}
            pricePoints={infoCard.pricePoints}
            sizeLabel={infoCard.size}
          />
        ) : (
          <ItemMemberSection
            data={memberData}
            isLoading={memberLoading}
            profileHref={ownerUserId ? `/membre/${ownerUserId}` : null}
          />
        )}

        {/* 4. Description */}
        <ItemDescriptionCard description={description} />

        {outfitLook && outfitCompanionItems.length > 0 ? (
          <ItemOutfitSection
            outfit={outfitLook}
            companionItems={outfitCompanionItems}
            initialCoverUrlById={outfitCompanionCoverUrlById}
            guestCashRental={guestCashRental}
          />
        ) : null}

        {/* 5. Autres photos produit (photo2–photo6) */}
        {catalogExtraPhotos.map(({ slotIndex, slot }) => (
          <ItemViewPhotoFrame
            key={`catalog-photo-${slotIndex + 1}`}
            slot={slot}
            frameKey={`photo_${slotIndex + 1}`}
            {...photoFrameProps}
          />
        ))}

        <ItemFeedbacksSection feedbacks={itemFeedbacks} />
        <ItemWornPhotosSection photos={wornPhotos} />
      </div>
    </div>
  );
}
