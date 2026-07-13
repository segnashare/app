"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { InspirationMediaViewer } from "@/components/community/InspirationMediaViewer";
import { isVideoMediaUrl } from "@/lib/community/inspiration-media-path";
import { inspirationMemberTag } from "@/lib/community/inspiration-member-tag";
import { styleLookHref } from "@/lib/looks/style-look-href";
import type { ItemStyleLookSummary } from "@/lib/items/fetch-item-style-looks";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

type ItemStyleLooksSectionProps = {
  looks: ItemStyleLookSummary[];
};

const montserrat = segnaMontserrat;

const TITLE = "Inspire-toi de ces looks";
const LOOK_THUMB_HALF_PX = 39;

function hasRenderableMedia(look: ItemStyleLookSummary): boolean {
  if (look.media_urls.length > 0) return true;
  return Boolean(look.poster_url);
}

function getLookThumbnailUrl(look: ItemStyleLookSummary): string | null {
  if (look.media_type === "video") {
    return look.poster_url ?? look.media_urls[0] ?? null;
  }
  const firstImage = look.media_urls.find((url) => !isVideoMediaUrl(url));
  return firstImage ?? look.poster_url ?? look.media_urls[0] ?? null;
}

export function ItemStyleLooksSection({ looks }: ItemStyleLooksSectionProps) {
  const visibleLooks = useMemo(() => looks.filter(hasRenderableMedia), [looks]);
  const [selectedLookIndex, setSelectedLookIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setSelectedLookIndex(0);
  }, [visibleLooks]);

  const centerSelectedThumb = useCallback((index: number) => {
    const container = scrollRef.current;
    const thumb = thumbRefs.current[index];
    if (!container || !thumb) return;

    const target =
      thumb.offsetLeft + thumb.offsetWidth / 2 - container.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, []);

  const safeLookIndex = Math.min(selectedLookIndex, Math.max(visibleLooks.length - 1, 0));
  const selectedLook = visibleLooks[safeLookIndex] ?? visibleLooks[0] ?? null;

  useLayoutEffect(() => {
    if (visibleLooks.length <= 1) return;
    centerSelectedThumb(safeLookIndex);
  }, [centerSelectedThumb, safeLookIndex, visibleLooks.length]);

  if (!selectedLook) return null;

  const lookHref = styleLookHref(selectedLook.id);
  const memberTag = inspirationMemberTag(
    selectedLook.author_display_name,
    selectedLook.author_instagram_username,
  );

  return (
    <section aria-label="Inspire-toi de ces looks" className="pt-6">
      <div className="px-6 pb-3">
        <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
          {TITLE}
        </h2>
      </div>

      <Link href={lookHref} aria-label="Afficher le look" className="relative block w-full bg-zinc-200">
        <InspirationMediaViewer
          mediaType={selectedLook.media_type}
          mediaUrls={selectedLook.media_urls}
          posterUrl={selectedLook.poster_url}
          coverAspect={selectedLook.cover_aspect}
          coverTransform={selectedLook.cover_transform}
          className="rounded-none"
          variant="detail"
          priority
        />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />

        <span
          className={cn(
            montserrat.className,
            "pointer-events-none absolute bottom-3 left-3 text-[11px] font-bold uppercase tracking-wide text-white drop-shadow-sm",
          )}
        >
          {memberTag}
        </span>
      </Link>

      {visibleLooks.length > 1 ? (
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            paddingLeft: `max(1.5rem, calc(50% - ${LOOK_THUMB_HALF_PX}px))`,
            paddingRight: `max(1.5rem, calc(50% - ${LOOK_THUMB_HALF_PX}px))`,
          }}
        >
          {visibleLooks.map((look, index) => {
            const selected = index === safeLookIndex;
            const thumbnailUrl = getLookThumbnailUrl(look);
            return (
              <button
                key={look.id}
                ref={(element) => {
                  thumbRefs.current[index] = element;
                }}
                type="button"
                aria-label={`Afficher le look ${look.title || index + 1}`}
                aria-pressed={selected}
                onClick={() => setSelectedLookIndex(index)}
                className={cn(
                  "relative h-[104px] w-[78px] shrink-0 rounded-xl bg-zinc-100 transition",
                  selected ? "ring-2 ring-inset ring-zinc-900" : "opacity-85 ring-2 ring-inset ring-transparent hover:opacity-100",
                )}
              >
                <div className="relative h-full w-full overflow-hidden rounded-[10px]">
                {thumbnailUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    {look.media_type === "video" || (thumbnailUrl && isVideoMediaUrl(thumbnailUrl)) ? (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                        <Play className="h-4 w-4 fill-white text-white" aria-hidden />
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-zinc-400">
                    —
                  </span>
                )}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
