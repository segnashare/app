"use client";

import { useState } from "react";
import { Heart, Plus } from "lucide-react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { ItemDescriptionCard } from "./ItemDescriptionCard";
import { ItemInfoCard } from "./ItemInfoCard";
import type { ItemInfoCardData } from "./ItemInfoCard";
import { ItemMemberSection } from "./ItemMemberSection";
import { ItemSegnaPropertyCmsSection } from "./ItemSegnaPropertyCmsSection";
import { useItemMemberData } from "@/hooks/useItemMemberData";
import { useSegnaStockPropertyCmsRows } from "@/hooks/useSegnaStockPropertyCmsRows";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { isSegnaCorporateInventoryUserId } from "@/lib/config/segna-corporate-inventory";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";



const ITEM_STAGE_RATIO = 1;

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
  imageRatio: number;
};

type ItemViewViewProps = {
  title: string;
  description: string;
  slots: Array<ItemViewSlot | null>;
  infoCard: ItemInfoCardData;
  ownerUserId?: string | null;
  onLikeFrame?: () => void;
  onFrameAction?: () => void;
  frameActionVariant?: "heart" | "plus";
  frameActionActive?: boolean;
  forceDarkFrameAction?: boolean;
  /** Masque les boutons cœur (ex. vue panier / catalogue sans interaction feed). */
  hideFrameLikeButtons?: boolean;
  /**
   * Frames CMS section `segna_stock_property` (Propriété Segna). Si défini (ex. SSR fiche pièce), pas de chargement client.
   */
  segnaStockPropertyCmsFrames?: CmsFrameRow[];
};

function ItemViewCoverPhoto({ slot, className }: { slot: ItemViewSlot; className?: string }) {
  return (
    <RemoteCoverThumb
      photoUrl={slot.dataUrl}
      frameClassName={cn("h-full w-full", className)}
      coverStyle={{
        backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / ITEM_STAGE_RATIO)) * slot.zoom}%`,
        backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

export function ItemViewView({
  description,
  slots,
  infoCard,
  ownerUserId,
  onLikeFrame,
  onFrameAction,
  frameActionVariant = "heart",
  frameActionActive = false,
  forceDarkFrameAction = false,
  hideFrameLikeButtons = false,
  segnaStockPropertyCmsFrames,
}: ItemViewViewProps) {
  const [likedFrames, setLikedFrames] = useState<Record<string, boolean>>({});
  const filledSlots = slots.filter((s): s is ItemViewSlot => Boolean(s));
  const isSegnaStockOwner = isSegnaCorporateInventoryUserId(ownerUserId);
  const fetchSegnaCmsClient = isSegnaStockOwner && segnaStockPropertyCmsFrames === undefined;
  const { rows: clientSegnaCmsRows, loading: segnaCmsLoading } = useSegnaStockPropertyCmsRows(fetchSegnaCmsClient);
  const segnaCmsRows = segnaStockPropertyCmsFrames !== undefined ? segnaStockPropertyCmsFrames : clientSegnaCmsRows;
  const { data: memberData, isLoading: memberLoading } = useItemMemberData(isSegnaStockOwner ? null : ownerUserId ?? null);
  const photo2 = filledSlots[1];
  const photo3 = filledSlots[2];
  const remainingPhotos = filledSlots.slice(3);

  function toggleFrameLike(frameId: string) {
    setLikedFrames((previous) => ({ ...previous, [frameId]: !previous[frameId] }));
  }

  return (
    <div className="bg-white pb-2 pt-2">
      {/* 1. Photo principale */}
      <div className="pb-2">
        {filledSlots[0] ? (
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-zinc-200 shadow-sm">
            <ItemViewCoverPhoto slot={filledSlots[0]} />
            {!hideFrameLikeButtons ? (
              <FrameActionButton
                variant={frameActionVariant}
                isActive={frameActionVariant === "heart" ? Boolean(likedFrames.photo_1) : frameActionActive}
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
                  toggleFrameLike("photo_1");
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-zinc-200 shadow-sm">
            <SegnaSkeletonBlock className="absolute inset-0 h-full w-full" rounded="rounded-2xl" />
          </div>
        )}
      </div>

      {/* 2. Fiche info */}
      <div className="pt-2">
        <ItemInfoCard data={infoCard} />
      </div>

      <div className="space-y-4 pt-4">
        {/* 3. Photo 2 */}
        {photo2 ? (
          <div className="relative overflow-hidden rounded-2xl border border-zinc-200 shadow-sm">
            <div className="relative aspect-square w-full">
              <ItemViewCoverPhoto slot={photo2} />
            </div>
            {!hideFrameLikeButtons ? (
              <FrameActionButton
                variant={frameActionVariant}
                isActive={frameActionVariant === "heart" ? Boolean(likedFrames.photo_2) : frameActionActive}
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
                  toggleFrameLike("photo_2");
                }}
              />
            ) : null}
          </div>
        ) : null}

        {/* 4. Fiche description */}
        <ItemDescriptionCard description={description} />

        {/* 5. Photo 3 */}
        {photo3 ? (
          <div className="relative overflow-hidden rounded-2xl border border-zinc-200 shadow-sm">
            <div className="relative aspect-square w-full">
              <ItemViewCoverPhoto slot={photo3} />
            </div>
            {!hideFrameLikeButtons ? (
              <FrameActionButton
                variant={frameActionVariant}
                isActive={frameActionVariant === "heart" ? Boolean(likedFrames.photo_3) : frameActionActive}
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
                  toggleFrameLike("photo_3");
                }}
              />
            ) : null}
          </div>
        ) : null}

        {/* 6. Section propriétaire : stock Segna (détention) ou profil membre */}
        {isSegnaStockOwner ? (
          <ItemSegnaPropertyCmsSection
            cmsRows={segnaCmsRows}
            loadingClientCms={fetchSegnaCmsClient && segnaCmsLoading}
            pricePoints={infoCard.pricePoints}
            sizeLabel={infoCard.size}
          />
        ) : (
          <ItemMemberSection data={memberData} isLoading={memberLoading} />
        )}

        {/* 7. Photos restantes (4, 5, 6) */}
        {remainingPhotos.map((slot, index) => (
          <div key={index} className="relative overflow-hidden rounded-2xl border border-zinc-200 shadow-sm">
            <div className="relative aspect-square w-full">
              <ItemViewCoverPhoto slot={slot} />
            </div>
            {!hideFrameLikeButtons ? (
              <FrameActionButton
                variant={frameActionVariant}
                isActive={frameActionVariant === "heart" ? Boolean(likedFrames[`photo_${index + 4}`]) : frameActionActive}
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
                  toggleFrameLike(`photo_${index + 4}`);
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
