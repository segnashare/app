"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isVideoMediaUrl } from "@/lib/community/inspiration-media-path";
import { GalleryDots } from "@/components/ui/GalleryDots";
import { LookMediaPhoto } from "@/components/look/LookMediaPhoto";

type LookMediaLightboxProps = {
  open: boolean;
  onClose: () => void;
  mediaUrls: string[];
  initialIndex?: number;
};

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

function LightboxVideo({ src, active }: { src: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active) {
      void video.play().catch(() => undefined);
      return;
    }
    video.pause();
    video.currentTime = 0;
  }, [active, src]);

  return (
    <video
      ref={ref}
      src={src}
      className="pointer-events-none h-full w-full object-contain"
      autoPlay
      playsInline
      muted
      loop
      preload="auto"
    />
  );
}

export function LookMediaLightbox({
  open,
  onClose,
  mediaUrls,
  initialIndex = 0,
}: LookMediaLightboxProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeIndex = useCarouselIndex(scrollRef, mediaUrls.length);
  const didInitialScroll = useRef(false);

  useEffect(() => {
    if (!open) return;
    didInitialScroll.current = false;
  }, [open, mediaUrls]);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el || didInitialScroll.current) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    el.scrollLeft = width * initialIndex;
    didInitialScroll.current = true;
  }, [initialIndex, mediaUrls.length, open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open || mediaUrls.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] w-screen max-w-[100vw] bg-black">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-[max(env(safe-area-inset-top,0px),16px)] z-20 p-1 text-white"
        aria-label="Fermer"
      >
        <X className="h-5 w-5" strokeWidth={2.4} />
      </button>

      <div
        ref={scrollRef}
        className="flex h-[100dvh] w-full snap-x snap-mandatory overflow-x-auto scroll-smooth bg-black [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {mediaUrls.map((url, index) => (
          <div
            key={`${url}-${index}`}
            className="relative h-[100dvh] min-w-full max-w-full shrink-0 snap-start snap-always overflow-hidden bg-black"
          >
            {isVideoMediaUrl(url) ? (
              <LightboxVideo src={url} active={activeIndex === index} />
            ) : (
              <LookMediaPhoto url={url} mode="lightbox" priority={index === initialIndex} />
            )}
          </div>
        ))}
      </div>

      <GalleryDots count={mediaUrls.length} activeIndex={activeIndex} variant="fullscreen" />
    </div>,
    document.body,
  );
}
