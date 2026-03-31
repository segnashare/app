"use client";

import { useState } from "react";

import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";

type ImageCoverWithSkeletonProps = {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  loading?: "eager" | "lazy";
  /** `cover` par défaut (vignettes) ; `contain` pour logos etc. */
  objectFit?: "cover" | "contain";
};

/**
 * Image plein cadre : squelette balayage jusqu’à onLoad, puis apparition nette (pas de dévoilement progressif).
 */
export function ImageCoverWithSkeleton(props: ImageCoverWithSkeletonProps) {
  return <ImageCoverWithSkeletonImpl key={props.src} {...props} />;
}

function ImageCoverWithSkeletonImpl({
  src,
  alt,
  className,
  imgClassName,
  loading = "lazy",
  objectFit = "cover",
}: ImageCoverWithSkeletonProps) {
  const [ready, setReady] = useState(false);

  return (
    <div className={cn("relative overflow-hidden bg-zinc-200", className)}>
      {!ready ? (
        <SegnaSkeletonBlock
          className="pointer-events-none absolute inset-0 z-[0]"
          rounded="rounded-none"
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        className={cn(
          "relative z-[1] h-full w-full [transition:none]",
          objectFit === "contain" ? "object-contain object-center" : "object-cover",
          ready ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
        onLoad={(event) => {
          const el = event.currentTarget;
          void (async () => {
            try {
              if (typeof el.decode === "function") await el.decode();
            } catch {
              /* decode peut échouer sur images corrompues : afficher quand même */
            }
            setReady(true);
          })();
        }}
        onError={() => setReady(true)}
      />
    </div>
  );
}
