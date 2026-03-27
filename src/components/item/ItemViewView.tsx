"use client";

import { useState } from "react";
import { Montserrat } from "next/font/google";
import { Heart } from "lucide-react";

import { ItemDescriptionCard } from "./ItemDescriptionCard";
import { ItemInfoCard } from "./ItemInfoCard";
import type { ItemInfoCardData } from "./ItemInfoCard";
import { ItemMemberSection } from "./ItemMemberSection";
import { useItemMemberData } from "@/hooks/useItemMemberData";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });

const ITEM_STAGE_RATIO = 1;

function FrameLikeButton({
  isLiked,
  onToggle,
}: {
  isLiked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={isLiked ? "Retirer le like" : "Liker cette frame"}
      onClick={onToggle}
      className="absolute bottom-4 right-4 z-10 grid h-14 w-14 place-items-center rounded-full bg-white/95 text-zinc-900 shadow-lg ring-1 ring-zinc-200 backdrop-blur-sm transition hover:scale-[1.02] active:scale-[0.98]"
    >
      <Heart className={cn("h-7 w-7", isLiked && "fill-current")} strokeWidth={2.2} />
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

export function ItemViewView({ description, slots, infoCard, ownerUserId, onLikeFrame }: ItemViewViewProps) {
  const [likedFrames, setLikedFrames] = useState<Record<string, boolean>>({});
  const filledSlots = slots.filter((s): s is ItemViewSlot => Boolean(s));
  const { data: memberData, isLoading: memberLoading } = useItemMemberData(ownerUserId ?? null);
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
            <FrameLikeButton
              isLiked={Boolean(likedFrames.photo_1)}
              onToggle={() => {
                if (onLikeFrame) {
                  onLikeFrame();
                  return;
                }
                toggleFrameLike("photo_1");
              }}
            />
          </div>
        ) : <div className="aspect-square w-full rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm" />}
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
            <FrameLikeButton
              isLiked={Boolean(likedFrames.photo_2)}
              onToggle={() => {
                if (onLikeFrame) {
                  onLikeFrame();
                  return;
                }
                toggleFrameLike("photo_2");
              }}
            />
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
            <FrameLikeButton
              isLiked={Boolean(likedFrames.photo_3)}
              onToggle={() => {
                if (onLikeFrame) {
                  onLikeFrame();
                  return;
                }
                toggleFrameLike("photo_3");
              }}
            />
          </div>
        ) : null}

        {/* 6. Section membre */}
        <ItemMemberSection data={memberData} isLoading={memberLoading} />

        {/* 7. Photos restantes (4, 5, 6) */}
        {remainingPhotos.map((slot, index) => (
          <div key={index} className="relative overflow-hidden rounded-2xl border border-zinc-200 shadow-sm">
            <div className="relative aspect-square w-full">
              <ItemViewCoverPhoto slot={slot} />
            </div>
            <FrameLikeButton
              isLiked={Boolean(likedFrames[`photo_${index + 4}`])}
              onToggle={() => {
                if (onLikeFrame) {
                  onLikeFrame();
                  return;
                }
                toggleFrameLike(`photo_${index + 4}`);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
