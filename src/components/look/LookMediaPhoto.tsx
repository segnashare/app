"use client";

import { InspirationCoverPhoto } from "@/components/community/InspirationCoverPhoto";
import type {
  InspirationCoverAspect,
  InspirationCoverTransform,
} from "@/lib/community/inspiration-cover-aspect";
import type { RemoteCoverLoadState } from "@/components/ui/RemoteCoverThumb";
import { cn } from "@/lib/utils/cn";

type LookMediaPhotoProps = {
  url: string;
  mode: "hero" | "lightbox";
  coverAspect?: InspirationCoverAspect;
  coverTransform?: InspirationCoverTransform | null;
  applyCoverCrop?: boolean;
  onLoadStateChange?: (state: RemoteCoverLoadState) => void;
  priority?: boolean;
  className?: string;
};

export function LookMediaPhoto({
  url,
  mode,
  coverAspect = "portrait",
  coverTransform = null,
  applyCoverCrop = false,
  onLoadStateChange,
  priority = false,
  className,
}: LookMediaPhotoProps) {
  if (mode === "lightbox") {
    return (
      <div className={cn("flex h-[100dvh] w-full items-center justify-center bg-black", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className="max-h-full max-w-full object-contain"
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          onLoad={() => onLoadStateChange?.("ready")}
          onError={() => onLoadStateChange?.("failed")}
        />
      </div>
    );
  }

  if (applyCoverCrop) {
    return (
      <InspirationCoverPhoto
        photoUrl={url}
        coverAspect={coverAspect}
        coverTransform={coverTransform}
        frameClassName="h-full w-full rounded-none"
        className={cn("h-full w-full rounded-none", className)}
        priority={priority}
        onLoadStateChange={onLoadStateChange}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className={cn("h-full w-full object-cover", className)}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      onLoad={() => onLoadStateChange?.("ready")}
      onError={() => onLoadStateChange?.("failed")}
    />
  );
}
