"use client";

import type { ItemWornPhotoDisplayRow } from "@/lib/feedback/item-feedback-types";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type ItemWornPhotosSectionProps = {
  photos: ItemWornPhotoDisplayRow[];
  className?: string;
};

export function ItemWornPhotosSection({ photos, className }: ItemWornPhotosSectionProps) {
  const visible = photos.filter((p) => p.previewUrl);
  if (visible.length === 0) return null;

  return (
    <section className={cn("space-y-3", className)}>
      <h2 className={cn(montserrat.className, "text-[16px] font-semibold text-zinc-500")}>Photos portées</h2>
      <div className="grid grid-cols-2 gap-3">
        {visible.map((photo) => (
          <div
            key={`${photo.feedbackId}-${photo.storagePath}`}
            className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-zinc-200 shadow-sm"
          >
            <RemoteCoverThumb photoUrl={photo.previewUrl!} frameClassName="h-full w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}
