"use client";

import { useMemo, type ReactNode } from "react";

import { PageImageReadyShell } from "@/components/ui/PageImageReadyShell";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { collectHomeHeroPreloadUrls } from "@/lib/home/collect-home-hero-preload-urls";

type HomePageReadyShellProps = {
  heroFrames: CmsFrameRow[];
  children: ReactNode;
};

export function HomePageReadyShell({ heroFrames, children }: HomePageReadyShellProps) {
  const preloadUrls = useMemo(() => collectHomeHeroPreloadUrls(heroFrames), [heroFrames]);
  const hasHero = heroFrames.some((row) => row.frame_type === "home_hero");

  if (!hasHero || preloadUrls.length === 0) {
    return children;
  }

  return (
    <PageImageReadyShell preloadUrls={preloadUrls} loadingLabel="Chargement de l'accueil">
      {children}
    </PageImageReadyShell>
  );
}
