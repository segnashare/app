"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { InspirationCoverPhoto } from "@/components/community/InspirationCoverPhoto";
import {
  inspirationCoverAspectClass,
  type InspirationCoverAspect,
  type InspirationCoverTransform,
} from "@/lib/community/inspiration-cover-aspect";
import type { InspirationMediaType } from "@/lib/community/types";
import { isVideoMediaUrl } from "@/lib/community/inspiration-media-path";
import { LookMediaPhoto } from "@/components/look/LookMediaPhoto";
import { GalleryDots } from "@/components/ui/GalleryDots";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { RemoteCoverLoadState } from "@/components/ui/RemoteCoverThumb";
import { cn } from "@/lib/utils/cn";

type InspirationMediaViewerProps = {
  mediaType: InspirationMediaType;
  mediaUrls: string[];
  posterUrl?: string | null;
  coverAspect?: InspirationCoverAspect;
  coverTransform?: InspirationCoverTransform | null;
  /** `detail` : plein écran fiche look / item (sans coins arrondis, RemoteCoverThumb). */
  variant?: "detail";
  className?: string;
  priority?: boolean;
  shimmerDurationSec?: number;
  onLoadStateChange?: (state: RemoteCoverLoadState) => void;
  /** Index contrôlé pour le carrousel dump (fiche look). */
  selectedSlideIndex?: number;
  onSelectedSlideIndexChange?: (index: number) => void;
  /** Ouvre le média en plein écran (fiche look). */
  onMediaClick?: (index: number) => void;
};

function useSwipeCarouselIndex(scrollRef: React.RefObject<HTMLDivElement | null>, slideCount: number) {
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

function DetailAmbientVideo({
  src,
  active = true,
  className,
  onReady,
}: {
  src: string;
  active?: boolean;
  className?: string;
  onReady?: () => void;
}) {
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
      className={cn("pointer-events-none h-full w-full object-cover", className)}
      autoPlay
      playsInline
      muted
      loop
      preload="auto"
      aria-hidden
      onLoadedData={() => onReady?.()}
    />
  );
}

function DetailMediaClickTarget({
  index,
  onMediaClick,
  className,
  children,
}: {
  index: number;
  onMediaClick?: (index: number) => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (!onMediaClick) {
    return <div className={className}>{children}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onMediaClick(index)}
      className={cn(
        "block w-full cursor-zoom-in border-0 bg-transparent p-0 [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      aria-label="Ouvrir en plein écran"
    >
      {children}
    </button>
  );
}

export function InspirationMediaViewer({
  mediaType,
  mediaUrls,
  posterUrl,
  coverAspect = "portrait",
  coverTransform = null,
  variant,
  className,
  priority = false,
  shimmerDurationSec,
  onLoadStateChange,
  selectedSlideIndex,
  onSelectedSlideIndexChange,
  onMediaClick,
}: InspirationMediaViewerProps) {
  const dumpScrollRef = useRef<HTMLDivElement | null>(null);
  const internalDumpIndex = useSwipeCarouselIndex(dumpScrollRef, mediaUrls.length);
  const dumpIndex = selectedSlideIndex ?? internalDumpIndex;
  const isMultiSlide = mediaUrls.length > 1;
  const [videoReady, setVideoReady] = useState(false);
  const [coverLoadState, setCoverLoadState] = useState<RemoteCoverLoadState>(() =>
    mediaUrls.length === 0 ? "ready" : "loading",
  );
  const aspectClass = inspirationCoverAspectClass(coverAspect);
  const isDetail = variant === "detail";
  const enableDumpCarousel = isDetail && isMultiSlide;
  const onLoadStateChangeRef = useRef(onLoadStateChange);
  const onSelectedSlideIndexChangeRef = useRef(onSelectedSlideIndexChange);

  const notifyCoverLoadState = useCallback((state: RemoteCoverLoadState) => {
    setCoverLoadState(state);
    onLoadStateChangeRef.current?.(state);
  }, []);

  useEffect(() => {
    onLoadStateChangeRef.current = onLoadStateChange;
  }, [onLoadStateChange]);

  useEffect(() => {
    onSelectedSlideIndexChangeRef.current = onSelectedSlideIndexChange;
  }, [onSelectedSlideIndexChange]);

  useEffect(() => {
    if (mediaType === "video") return;
    const nextState: RemoteCoverLoadState = mediaUrls.length === 0 ? "ready" : "loading";
    setCoverLoadState(nextState);
    if (mediaUrls.length > 0) notifyCoverLoadState("loading");
  }, [mediaType, mediaUrls, notifyCoverLoadState]);

  useEffect(() => {
    const primaryUrl = mediaUrls[0];
    const usesPrimaryAmbientVideo =
      mediaType === "video" ||
      Boolean(primaryUrl && isVideoMediaUrl(primaryUrl) && !(isDetail && isMultiSlide));
    if (!usesPrimaryAmbientVideo) return;
    setVideoReady(false);
    notifyCoverLoadState("loading");
  }, [isDetail, isMultiSlide, mediaType, mediaUrls, notifyCoverLoadState]);

  useEffect(() => {
    const el = dumpScrollRef.current;
    if (!el) return;
    el.scrollLeft = 0;
  }, [mediaUrls, mediaType]);

  useEffect(() => {
    if (selectedSlideIndex === undefined) return;
    const el = dumpScrollRef.current;
    if (!el) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    el.scrollTo({ left: width * selectedSlideIndex, behavior: "smooth" });
  }, [selectedSlideIndex]);

  useEffect(() => {
    const el = dumpScrollRef.current;
    if (!el || !onSelectedSlideIndexChangeRef.current) return;

    const syncIndex = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const next = Math.max(0, Math.min(mediaUrls.length - 1, Math.round(el.scrollLeft / width)));
      onSelectedSlideIndexChangeRef.current?.(next);
    };

    el.addEventListener("scroll", syncIndex, { passive: true });
    return () => el.removeEventListener("scroll", syncIndex);
  }, [mediaUrls.length]);

  if (mediaUrls.length === 0) {
    return (
      <div
        className={cn("relative w-full overflow-hidden", aspectClass, !isDetail && "rounded-2xl", className)}
        aria-hidden
      >
        <SegnaSkeletonBlock
          className="absolute inset-0 h-full w-full"
          rounded="rounded-none"
          shimmerDurationSec={shimmerDurationSec}
        />
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <div
        className={cn(
          "relative w-full overflow-hidden bg-zinc-200",
          aspectClass,
          !isDetail && "rounded-2xl",
          className,
        )}
      >
        {!videoReady ? (
          <SegnaSkeletonBlock
            className="pointer-events-none absolute inset-0 z-[2]"
            rounded="rounded-none"
            shimmerDurationSec={shimmerDurationSec}
          />
        ) : null}
        <DetailMediaClickTarget
          index={0}
          onMediaClick={isDetail ? onMediaClick : undefined}
          className="relative z-[1] h-full w-full"
        >
          <DetailAmbientVideo
            src={mediaUrls[0]}
            className={cn("h-full w-full", !videoReady && "opacity-0")}
            onReady={() => {
              setVideoReady(true);
              notifyCoverLoadState("ready");
            }}
          />
        </DetailMediaClickTarget>
      </div>
    );
  }

  if (enableDumpCarousel) {
    return (
      <div
        className={cn(
          "relative w-full overflow-hidden bg-zinc-200",
          aspectClass,
          !isDetail && "rounded-2xl",
          className,
        )}
      >
        {coverLoadState === "loading" ? (
          <SegnaSkeletonBlock
            className="pointer-events-none absolute inset-0 z-[3]"
            rounded="rounded-none"
            shimmerDurationSec={shimmerDurationSec}
          />
        ) : null}
        <div
          ref={dumpScrollRef}
          className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {mediaUrls.map((url, index) => (
            <DetailMediaClickTarget
              key={`${url}-${index}`}
              index={index}
              onMediaClick={isDetail ? onMediaClick : undefined}
              className="relative h-full min-w-full flex-[0_0_100%] snap-center snap-always"
            >
              {isVideoMediaUrl(url) ? (
                <DetailAmbientVideo
                  src={url}
                  active={dumpIndex === index}
                  className="h-full w-full"
                  onReady={index === 0 ? () => notifyCoverLoadState("ready") : undefined}
                />
              ) : isDetail ? (
                <LookMediaPhoto
                  url={url}
                  mode="hero"
                  coverAspect={coverAspect}
                  coverTransform={index === 0 ? coverTransform : null}
                  applyCoverCrop={index === 0}
                  priority={priority && index === 0}
                  shimmerDurationSec={shimmerDurationSec}
                  onLoadStateChange={index === 0 ? notifyCoverLoadState : undefined}
                />
              ) : (
                <InspirationCoverPhoto
                  photoUrl={url}
                  coverAspect={coverAspect}
                  coverTransform={index === 0 ? coverTransform : null}
                  frameClassName="h-full rounded-none"
                  priority={priority && index === 0}
                  shimmerDurationSec={shimmerDurationSec}
                  onLoadStateChange={index === 0 ? notifyCoverLoadState : undefined}
                />
              )}
            </DetailMediaClickTarget>
          ))}
        </div>
        {coverLoadState !== "loading" ? (
          <GalleryDots
            count={mediaUrls.length}
            activeIndex={dumpIndex}
            variant={isDetail ? "fullscreen" : "light"}
          />
        ) : null}
      </div>
    );
  }

  if (isDetail) {
    return (
      <div className={cn("relative w-full overflow-hidden bg-zinc-200", aspectClass, className)}>
        <DetailMediaClickTarget index={0} onMediaClick={onMediaClick} className="relative h-full w-full">
          <LookMediaPhoto
            url={mediaUrls[0]}
            mode="hero"
            coverAspect={coverAspect}
            coverTransform={coverTransform}
            applyCoverCrop
            priority={priority}
            shimmerDurationSec={shimmerDurationSec}
            onLoadStateChange={notifyCoverLoadState}
          />
        </DetailMediaClickTarget>
      </div>
    );
  }

  const previewUrl = mediaUrls[0];
  if (isVideoMediaUrl(previewUrl)) {
    return (
      <div
        className={cn(
          "relative w-full overflow-hidden bg-zinc-200",
          aspectClass,
          "rounded-2xl",
          className,
        )}
      >
        {!videoReady ? (
          <SegnaSkeletonBlock
            className="pointer-events-none absolute inset-0 z-[2]"
            rounded="rounded-none"
            shimmerDurationSec={shimmerDurationSec}
          />
        ) : null}
        <DetailAmbientVideo
          src={previewUrl}
          className={cn("h-full w-full", !videoReady && "opacity-0")}
          onReady={() => {
            setVideoReady(true);
            notifyCoverLoadState("ready");
          }}
        />
      </div>
    );
  }

  return (
    <InspirationCoverPhoto
      photoUrl={mediaUrls[0]}
      coverAspect={coverAspect}
      coverTransform={coverTransform}
      className={cn("rounded-2xl", className)}
      priority={priority}
      shimmerDurationSec={shimmerDurationSec}
      onLoadStateChange={notifyCoverLoadState}
    />
  );
}
