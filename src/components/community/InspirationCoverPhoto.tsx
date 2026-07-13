"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { RemoteCoverLoadState } from "@/components/ui/RemoteCoverThumb";
import {
  DEFAULT_INSPIRATION_COVER_TRANSFORM,
  inspirationCoverAspectClass,
  type InspirationCoverAspect,
  type InspirationCoverTransform,
} from "@/lib/community/inspiration-cover-aspect";
import { cn } from "@/lib/utils/cn";

type InspirationCoverPhotoProps = {
  photoUrl: string;
  coverAspect?: InspirationCoverAspect;
  coverTransform?: InspirationCoverTransform | null;
  className?: string;
  frameClassName?: string;
  priority?: boolean;
  shimmerDurationSec?: number;
  onLoadStateChange?: (state: RemoteCoverLoadState) => void;
};

export function InspirationCoverPhoto({
  photoUrl,
  coverAspect = "portrait",
  coverTransform,
  className,
  frameClassName,
  priority = false,
  shimmerDurationSec,
  onLoadStateChange,
}: InspirationCoverPhotoProps) {
  const transform = coverTransform ?? DEFAULT_INSPIRATION_COVER_TRANSFORM;
  const [ready, setReady] = useState(false);
  const [imageRatio, setImageRatio] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const onLoadStateChangeRef = useRef(onLoadStateChange);

  useEffect(() => {
    onLoadStateChangeRef.current = onLoadStateChange;
  }, [onLoadStateChange]);

  useEffect(() => {
    onLoadStateChangeRef.current?.(ready ? "ready" : "loading");
  }, [ready]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    const image = new Image();
    image.onload = () => {
      void (async () => {
        if (image.width > 0 && image.height > 0) {
          setImageRatio(image.width / image.height);
        }
        try {
          if (typeof image.decode === "function") await image.decode();
        } catch {
          /* ignore */
        }
        if (!cancelled) setReady(true);
      })();
    };
    image.onerror = () => {
      if (!cancelled) {
        onLoadStateChangeRef.current?.("failed");
      }
    };
    image.src = photoUrl;

    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [photoUrl, coverAspect, ready]);

  const backgroundSizePercent = useMemo(() => {
    const stageWidth = Math.max(stageSize.width, 1);
    const stageHeight = Math.max(stageSize.height, 1);
    const stageRatio = stageWidth / stageHeight;
    const baseWidthPercent = Math.max(100, 100 * (imageRatio / stageRatio));
    return baseWidthPercent * transform.zoom;
  }, [imageRatio, stageSize.height, stageSize.width, transform.zoom]);

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative w-full overflow-hidden bg-zinc-200",
        inspirationCoverAspectClass(coverAspect),
        frameClassName,
        className,
      )}
      role="img"
      aria-hidden={priority ? undefined : true}
    >
      {!ready ? (
        <SegnaSkeletonBlock
          className="pointer-events-none absolute inset-0 z-[2]"
          rounded="rounded-none"
          shimmerDurationSec={shimmerDurationSec}
        />
      ) : null}
      {ready ? (
        <div
          className="absolute inset-0 z-[1] bg-no-repeat"
          style={{
            backgroundImage: `url(${photoUrl})`,
            backgroundPosition: `calc(50% + ${transform.offset.x}%) calc(50% + ${transform.offset.y}%)`,
            backgroundSize: `${backgroundSizePercent}%`,
          }}
        />
      ) : null}
    </div>
  );
}
