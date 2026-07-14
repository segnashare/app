"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { HeroMediaWarmProvider } from "@/components/home/HeroMediaWarmContext";
import { AppPageLoading } from "@/components/ui/AppPageLoading";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { collectHomeHeroPreloadMedia } from "@/lib/home/collect-home-hero-preload-urls";
import { preloadHeroMediaWarm } from "@/lib/ui/preload-remote-images";

type HomePageReadyShellProps = {
  heroFrames: CmsFrameRow[];
  children: ReactNode;
};

export function HomePageReadyShell({ heroFrames, children }: HomePageReadyShellProps) {
  const preloadMedia = useMemo(() => collectHomeHeroPreloadMedia(heroFrames), [heroFrames]);
  const hasHero = heroFrames.some((row) => row.frame_type === "home_hero");
  const needsPreload = hasHero && preloadMedia.length > 0;
  const [state, setState] = useState<{
    ready: boolean;
    warmed: Map<string, string>;
  }>(() => ({
    ready: !needsPreload,
    warmed: new Map(),
  }));

  useEffect(() => {
    if (!needsPreload) {
      setState({ ready: true, warmed: new Map() });
      return;
    }

    let cancelled = false;
    setState({ ready: false, warmed: new Map() });

    void preloadHeroMediaWarm(preloadMedia, { timeoutMs: 20_000 }).then((warmed) => {
      if (cancelled) return;
      setState({ ready: true, warmed });
    });

    return () => {
      cancelled = true;
    };
  }, [needsPreload, preloadMedia]);

  if (!state.ready) {
    return <AppPageLoading label="Chargement de l'accueil" />;
  }

  return <HeroMediaWarmProvider warmed={state.warmed}>{children}</HeroMediaWarmProvider>;
}
