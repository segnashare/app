import type { CmsFramePayload, CmsFrameRow } from "@/lib/cms/cms-types";
import type { RemoteMediaPreload } from "@/lib/ui/preload-remote-images";

function heroPreloadFromPayload(payload: CmsFramePayload): RemoteMediaPreload | null {
  const bg = payload.background;
  if (!bg) return null;
  if (bg.kind === "video") {
    const signed = typeof bg.video?.signed_url === "string" ? bg.video.signed_url.trim() : "";
    return signed ? { url: signed, kind: "video" } : null;
  }
  if (bg.kind === "image") {
    const signed = typeof bg.image?.signed_url === "string" ? bg.image.signed_url.trim() : "";
    return signed ? { url: signed, kind: "image" } : null;
  }
  return null;
}

/** Visuel critique : première slide hero uniquement (image ou vidéo). */
export function collectHomeHeroPreloadMedia(frames: CmsFrameRow[]): RemoteMediaPreload[] {
  const firstHero = frames.find((row) => row.frame_type === "home_hero");
  if (!firstHero) return [];
  const item = heroPreloadFromPayload(firstHero.payload);
  return item ? [item] : [];
}

/** @deprecated Préférer `collectHomeHeroPreloadMedia` (vidéos incluses). */
export function collectHomeHeroPreloadUrls(frames: CmsFrameRow[]): string[] {
  return collectHomeHeroPreloadMedia(frames).map((item) => item.url);
}
