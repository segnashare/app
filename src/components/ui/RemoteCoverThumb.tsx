"use client";

import { Image as ImageIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils/cn";

type PhotoPosition = {
  offset?: { x?: number; y?: number };
  zoom?: number;
  aspect?: string;
} | null;

type RemoteCoverThumbProps = {
  photoUrl: string;
  /** Classes for the outer frame (e.g. aspect-square w-[100px] rounded-md) */
  frameClassName?: string;
  className?: string;
  /**
   * Exchange-style crop (offset % + zoom as scale of 100%).
   * Ignored if `coverStyle` is passed.
   */
  photoPosition?: PhotoPosition;
  /**
   * Full background-* style except `backgroundImage` (added when loaded).
   * Use for item view slots (imageRatio × zoom sizing).
   */
  coverStyle?: Pick<CSSProperties, "backgroundSize" | "backgroundPosition" | "backgroundRepeat">;
};

function exchangeCoverStyle(photoPosition: PhotoPosition): Pick<CSSProperties, "backgroundSize" | "backgroundPosition" | "backgroundRepeat"> {
  return {
    backgroundSize: `${Math.max(100, Number(photoPosition?.zoom ?? 1) * 100)}%`,
    backgroundPosition: `calc(50% + ${Number(photoPosition?.offset?.x ?? 0)}%) calc(50% + ${Number(photoPosition?.offset?.y ?? 0)}%)`,
    backgroundRepeat: "no-repeat",
  };
}

/**
 * Grey frame while loading; shows cropped cover only once the image has loaded —
 * no black placeholder or progressive “sweep” on decode.
 */
export function RemoteCoverThumb({ photoUrl, frameClassName, className, photoPosition, coverStyle }: RemoteCoverThumbProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const bgExtras = coverStyle ?? exchangeCoverStyle(photoPosition ?? null);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setReady(true);
    };
    img.onerror = () => {
      if (!cancelled) {
        setFailed(true);
      }
    };
    img.src = photoUrl;
    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  return (
    <div className={cn("overflow-hidden bg-zinc-200", frameClassName)}>
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-zinc-400">
          <ImageIcon className="h-7 w-7" aria-hidden />
        </div>
      ) : ready ? (
        <div
          className={cn("h-full w-full bg-center bg-no-repeat", className)}
          style={{
            ...bgExtras,
            backgroundImage: `url(${photoUrl})`,
          }}
        />
      ) : null}
    </div>
  );
}
