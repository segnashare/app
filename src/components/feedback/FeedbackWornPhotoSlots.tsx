"use client";

import { Plus, X } from "lucide-react";
import { useRef } from "react";

import { ImageCoverWithSkeleton } from "@/components/ui/ImageCoverWithSkeleton";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

export const FEEDBACK_WORN_PHOTO_SLOT_COUNT = 3;

export type FeedbackWornPhotoDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

export type FeedbackWornPhotoExisting = {
  id: string;
  previewUrl: string;
  storagePath: string;
};

type FeedbackWornPhotoSlotsProps = {
  existingPhotos: FeedbackWornPhotoExisting[];
  newPhotos: FeedbackWornPhotoDraft[];
  onNewPhotosChange: (photos: FeedbackWornPhotoDraft[]) => void;
  onRemoveExisting: (id: string) => void;
  disabled?: boolean;
};

export function FeedbackWornPhotoSlots({
  existingPhotos,
  newPhotos,
  onNewPhotosChange,
  onRemoveExisting,
  disabled = false,
}: FeedbackWornPhotoSlotsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filledCount = existingPhotos.length + newPhotos.length;
  const canAddMore = filledCount < FEEDBACK_WORN_PHOTO_SLOT_COUNT;

  function appendFile(file: File) {
    if (!canAddMore || !file.type.startsWith("image/")) return;
    onNewPhotosChange([
      ...newPhotos,
      {
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      },
    ]);
  }

  function removeNewPhoto(id: string) {
    const removed = newPhotos.find((p) => p.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    onNewPhotosChange(newPhotos.filter((p) => p.id !== id));
  }

  const emptySlotCount = Math.max(0, FEEDBACK_WORN_PHOTO_SLOT_COUNT - filledCount);

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={cn(segnaMontserrat.className, "text-[13px] font-semibold text-zinc-700")}>
          Photos portées
        </p>
        <span className={cn(segnaMontserrat.className, "text-[12px] font-semibold text-[#5E3023]")}>
          +5 crédits
        </span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled || !canAddMore}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) appendFile(file);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-3 gap-2">
        {existingPhotos.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-[3/4] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
          >
            <ImageCoverWithSkeleton
              src={photo.previewUrl}
              alt=""
              className="h-full w-full"
              imgClassName="rounded-xl"
              loading="lazy"
            />
            {!disabled ? (
              <button
                type="button"
                onClick={() => onRemoveExisting(photo.id)}
                className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                aria-label="Retirer la photo"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
        {newPhotos.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-[3/4] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
          >
            <ImageCoverWithSkeleton
              src={photo.previewUrl}
              alt=""
              className="h-full w-full"
              imgClassName="rounded-xl"
              loading="lazy"
            />
            {!disabled ? (
              <button
                type="button"
                onClick={() => removeNewPhoto(photo.id)}
                className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                aria-label="Retirer la photo"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
        {Array.from({ length: emptySlotCount }).map((_, index) => (
          <button
            key={`empty-${index}`}
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-800 disabled:opacity-50"
          >
            <Plus className="h-6 w-6" />
            <span className={cn(segnaMontserrat.className, "text-[11px] font-semibold")}>Ajouter</span>
          </button>
        ))}
      </div>
    </div>
  );
}
