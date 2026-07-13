import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { collectSignedUrlsFromCmsValue } from "@/lib/ui/preload-remote-images";

/** Visuel critique : première slide hero uniquement (affichage le plus rapide). */
export function collectHomeHeroPreloadUrls(frames: CmsFrameRow[]): string[] {
  const firstHero = frames.find((row) => row.frame_type === "home_hero");
  if (!firstHero) return [];
  return [...collectSignedUrlsFromCmsValue(firstHero.payload)];
}
