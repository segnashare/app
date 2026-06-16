"use client";

import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { InspirationMediaType } from "@/lib/community/types";
import { cn } from "@/lib/utils/cn";

type InspirationMediaViewerProps = {
  mediaType: InspirationMediaType;
  mediaUrls: string[];
  posterUrl?: string | null;
  className?: string;
  autoplayVideo?: boolean;
  priority?: boolean;
};

export function InspirationMediaViewer({
  mediaType,
  mediaUrls,
  posterUrl,
  className,
  autoplayVideo = false,
  priority = false,
}: InspirationMediaViewerProps) {
  const [dumpIndex, setDumpIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const goPrev = useCallback(() => {
    setDumpIndex((i) => (i <= 0 ? Math.max(mediaUrls.length - 1, 0) : i - 1));
  }, [mediaUrls.length]);

  const goNext = useCallback(() => {
    setDumpIndex((i) => (i >= mediaUrls.length - 1 ? 0 : i + 1));
  }, [mediaUrls.length]);

  useEffect(() => {
    setDumpIndex(0);
  }, [mediaUrls, mediaType]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mediaType !== "video" || !autoplayVideo) return;
    void video.play().catch(() => undefined);
  }, [autoplayVideo, mediaType, mediaUrls]);

  if (mediaUrls.length === 0) {
    return (
      <div className={cn("aspect-[3/4] w-full rounded-2xl bg-zinc-100", className)} aria-hidden />
    );
  }

  if (mediaType === "video") {
    return (
      <div className={cn("relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black", className)}>
        <video
          ref={videoRef}
          src={mediaUrls[0]}
          poster={posterUrl ?? undefined}
          className="h-full w-full object-cover"
          controls
          playsInline
          muted={autoplayVideo}
          loop
          preload="metadata"
        />
        {!autoplayVideo ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
              <Play className="h-6 w-6 fill-current" aria-hidden />
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  if (mediaType === "dump" && mediaUrls.length > 1) {
    return (
      <div className={cn("relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-zinc-100", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrls[dumpIndex] ?? mediaUrls[0]}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading={priority && dumpIndex === 0 ? "eager" : "lazy"}
        />
        <button
          type="button"
          onClick={goPrev}
          className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow"
          aria-label="Photo précédente"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={goNext}
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow"
          aria-label="Photo suivante"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
          {mediaUrls.map((_, i) => (
            <span
              key={i}
              className={cn("h-1.5 w-1.5 rounded-full", i === dumpIndex ? "bg-white" : "bg-white/50")}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-zinc-100", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaUrls[0]}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        loading={priority ? "eager" : "lazy"}
      />
    </div>
  );
}
