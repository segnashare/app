"use client";

import { Montserrat } from "next/font/google";

import { ItemDescriptionCard } from "./ItemDescriptionCard";
import { ItemInfoCard } from "./ItemInfoCard";
import type { ItemInfoCardData } from "./ItemInfoCard";
import { ItemMemberSection } from "./ItemMemberSection";
import { useItemMemberData } from "@/hooks/useItemMemberData";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });

const ITEM_STAGE_RATIO = 1;

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
};

function ItemPhoto({ slot, className }: { slot: ItemViewSlot; className?: string }) {
  return (
    <div
      className={cn("h-full w-full bg-center bg-no-repeat", className)}
      style={{
        backgroundColor: "#000000",
        backgroundImage: `url(${slot.dataUrl})`,
        backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / ITEM_STAGE_RATIO)) * slot.zoom}%`,
        backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
      }}
    />
  );
}

export function ItemViewView({ description, slots, infoCard, ownerUserId }: ItemViewViewProps) {
  const filledSlots = slots.filter((s): s is ItemViewSlot => Boolean(s));
  const { data: memberData, isLoading: memberLoading } = useItemMemberData(ownerUserId ?? null);
  const photo2 = filledSlots[1];
  const photo3 = filledSlots[2];
  const remainingPhotos = filledSlots.slice(3);

  return (
    <div className="min-h-full bg-white pb-6 pt-8">
      {/* 1. Photo principale */}
      <div className="pb-2">
        {filledSlots[0] ? (
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <ItemPhoto slot={filledSlots[0]} />
          </div>
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-200 shadow-sm">
            <span className={cn(montserrat.className, "text-zinc-500")}>Photo principale</span>
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
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <ItemPhoto slot={photo2} />
            </div>
          </div>
        ) : null}

        {/* 4. Fiche description */}
        <ItemDescriptionCard description={description} />

        {/* 5. Photo 3 */}
        {photo3 ? (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <ItemPhoto slot={photo3} />
            </div>
          </div>
        ) : null}

        {/* 6. Section membre */}
        <ItemMemberSection data={memberData} isLoading={memberLoading} />

        {/* 7. Photos restantes (4, 5, 6) */}
        {remainingPhotos.map((slot, index) => (
          <div key={index} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="relative aspect-square w-full">
              <ItemPhoto slot={slot} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
