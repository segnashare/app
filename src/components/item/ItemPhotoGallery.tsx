"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { GalleryDots } from "@/components/ui/GalleryDots";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { ItemPhotoLayout } from "@/lib/items/item-photo-layout";
import { itemPhotoDisplayAspectClass } from "@/lib/items/item-photo-layout";
import { cn } from "@/lib/utils/cn";

import type { ItemViewSlot } from "./ItemViewView";

type ItemPhotoGalleryProps = {
  photos: ItemViewSlot[];
  photosLayout: ItemPhotoLayout;
  loading?: boolean;
  overlay?: React.ReactNode;
};

function GallerySlide({
  slot,
  photosLayout,
  onClick,
  variant,
}: {
  slot: ItemViewSlot;
  photosLayout: ItemPhotoLayout;
  onClick?: () => void;
  variant: "inline" | "fullscreen";
}) {
  const [imageRatio, setImageRatio] = useState<number | null>(null);
  const aspectClass = variant === "fullscreen" ? "h-full w-full" : itemPhotoDisplayAspectClass(photosLayout, imageRatio);

  const content = (
    <div
      className={cn(
        "relative w-full",
        variant === "fullscreen" ? "h-[100dvh] w-full" : aspectClass,
      )}
    >
      <RemoteCoverThumb
        photoUrl={slot.dataUrl}
        frameClassName={cn("h-full w-full", variant === "fullscreen" && "absolute inset-0")}
        photoPosition={{ offset: slot.offset, zoom: slot.zoom }}
        photoCoverFill
        photosLayout={photosLayout}
        onImageDimensions={(size) => {
          if (size.h > 0) setImageRatio(size.w / size.h);
        }}
      />
    </div>
  );

  if (variant === "fullscreen") {
    return (
      <div className="relative h-[100dvh] w-full min-w-full max-w-full shrink-0 snap-start snap-always overflow-hidden bg-black">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative block w-full min-w-full max-w-full shrink-0 cursor-zoom-in snap-start snap-always overflow-hidden border-0 bg-zinc-950 p-0 [-webkit-tap-highlight-color:transparent]"
      aria-label="Ouvrir la photo en plein écran"
    >
      {content}
    </button>
  );
}

function useCarouselIndex(scrollRef: React.RefObject<HTMLDivElement | null>, slideCount: number) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || slideCount <= 0) return;

    const syncIndex = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const next = Math.max(0, Math.min(slideCount - 1, Math.round(el.scrollLeft / width)));
      setIndex(next);
    };

    syncIndex();
    el.addEventListener("scroll", syncIndex, { passive: true });
    return () => el.removeEventListener("scroll", syncIndex);
  }, [scrollRef, slideCount]);

  return index;
}

function PhotoCarousel({
  photos,
  photosLayout,
  variant,
  initialIndex = 0,
  onPhotoClick,
  onClose,
  overlay,
}: {
  photos: ItemViewSlot[];
  photosLayout: ItemPhotoLayout;
  variant: "inline" | "fullscreen";
  initialIndex?: number;
  onPhotoClick?: (index: number) => void;
  onClose?: () => void;
  overlay?: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const index = useCarouselIndex(scrollRef, photos.length);
  const didInitialScroll = useRef(false);

  useEffect(() => {
    didInitialScroll.current = false;
  }, [photos, variant]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || didInitialScroll.current) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    el.scrollLeft = width * initialIndex;
    didInitialScroll.current = true;
  }, [initialIndex, photos.length, variant]);

  if (photos.length === 0) {
    return (
      <div className={cn("relative w-full bg-zinc-100", variant === "inline" ? "aspect-[3/4]" : "h-[100dvh]")}>
        <SegnaSkeletonBlock className="absolute inset-0 h-full w-full" rounded="rounded-none" />
        {variant === "inline" ? overlay : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        variant === "fullscreen" && "fixed inset-0 z-[130] w-screen max-w-[100vw] bg-black",
      )}
    >
      {variant === "inline" ? overlay : null}
      {variant === "fullscreen" ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-[max(env(safe-area-inset-top,0px),16px)] z-20 p-1 text-zinc-900"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" strokeWidth={2.4} />
        </button>
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          "flex w-full gap-0 overflow-x-auto scroll-smooth bg-zinc-950 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          variant === "inline" ? "snap-x snap-mandatory" : "h-[100dvh] w-full snap-x snap-mandatory",
        )}
      >
        {photos.map((slot, i) => (
          <GallerySlide
            key={`${slot.dataUrl}-${i}`}
            slot={slot}
            photosLayout={photosLayout}
            variant={variant}
            onClick={variant === "inline" ? () => onPhotoClick?.(i) : undefined}
          />
        ))}
      </div>

      <GalleryDots count={photos.length} activeIndex={index} variant={variant} />
    </div>
  );
}

export function ItemPhotoGallery({ photos, photosLayout, loading = false, overlay }: ItemPhotoGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  useEffect(() => {
    if (!lightboxOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxOpen]);

  if (loading) {
    return (
      <div className="relative aspect-[3/4] w-full bg-zinc-100">
        <SegnaSkeletonBlock className="absolute inset-0 h-full w-full" rounded="rounded-none" />
        {overlay}
      </div>
    );
  }

  return (
    <>
      <PhotoCarousel
        photos={photos}
        photosLayout={photosLayout}
        variant="inline"
        overlay={overlay}
        onPhotoClick={(index) => {
          setLightboxIndex(index);
          setLightboxOpen(true);
        }}
      />

      {lightboxOpen && typeof document !== "undefined"
        ? createPortal(
            <PhotoCarousel
              photos={photos}
              photosLayout={photosLayout}
              variant="fullscreen"
              initialIndex={lightboxIndex}
              onClose={() => setLightboxOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}
