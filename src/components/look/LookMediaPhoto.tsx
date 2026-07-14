"use client";

import { useEffect, useRef, useState } from "react";

import { InspirationCoverPhoto } from "@/components/community/InspirationCoverPhoto";
import type {
  InspirationCoverAspect,
  InspirationCoverTransform,
} from "@/lib/community/inspiration-cover-aspect";
import type { RemoteCoverLoadState } from "@/components/ui/RemoteCoverThumb";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";

type LookMediaPhotoProps = {
  url: string;
  mode: "hero" | "lightbox";
  coverAspect?: InspirationCoverAspect;
  coverTransform?: InspirationCoverTransform | null;
  applyCoverCrop?: boolean;
  onLoadStateChange?: (state: RemoteCoverLoadState) => void;
  priority?: boolean;
  shimmerDurationSec?: number;
  className?: string;
};

function LookMediaPhotoPlain({
  url,
  onLoadStateChange,
  priority = false,
  shimmerDurationSec,
  className,
}: {
  url: string;
  onLoadStateChange?: (state: RemoteCoverLoadState) => void;
  priority?: boolean;
  shimmerDurationSec?: number;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const onLoadStateChangeRef = useRef(onLoadStateChange);

  useEffect(() => {
    onLoadStateChangeRef.current = onLoadStateChange;
  }, [onLoadStateChange]);

  useEffect(() => {
    setReady(false);
    onLoadStateChangeRef.current?.("loading");
  }, [url]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-zinc-200", className)}>
      {!ready ? (
        <SegnaSkeletonBlock
          className="pointer-events-none absolute inset-0 z-[2]"
          rounded="rounded-none"
          shimmerDurationSec={shimmerDurationSec}
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className={cn("relative z-[1] h-full w-full object-cover", !ready && "opacity-0")}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => {
          setReady(true);
          onLoadStateChangeRef.current?.("ready");
        }}
        onError={() => onLoadStateChangeRef.current?.("failed")}
      />
    </div>
  );
}

export function LookMediaPhoto({
  url,
  mode,
  coverAspect = "portrait",
  coverTransform = null,
  applyCoverCrop = false,
  onLoadStateChange,
  priority = false,
  shimmerDurationSec,
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
        shimmerDurationSec={shimmerDurationSec}
        onLoadStateChange={onLoadStateChange}
      />
    );
  }

  return (
    <LookMediaPhotoPlain
      url={url}
      onLoadStateChange={onLoadStateChange}
      priority={priority}
      shimmerDurationSec={shimmerDurationSec}
      className={className}
    />
  );
}
