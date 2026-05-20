"use client";

import Link from "next/link";
import { ImageCoverWithSkeleton } from "@/components/ui/ImageCoverWithSkeleton";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
import type { ProfileViewCatalogItem } from "./ProfileView";

const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

const CARD_SHELL_CLASS =
  "block overflow-hidden rounded-2xl border border-zinc-200 bg-white px-3.5 py-3 shadow-sm transition active:scale-[0.995]";

type Props = {
  items: ProfileViewCatalogItem[];
  className?: string;
};

function ProfileCatalogItemFrame({ item }: { item: ProfileViewCatalogItem }) {
  const metaParts: string[] = [];
  if (item.brandLabel) metaParts.push(item.brandLabel);
  if (item.pricePoints != null && item.pricePoints > 0) metaParts.push(`${item.pricePoints} pts`);

  return (
    <Link
      href={`/items/${item.id}`}
      className={CARD_SHELL_CLASS}
      aria-label={`Voir ${item.title}${item.brandLabel ? `, ${item.brandLabel}` : ""}`}
    >
      <h3
        className={cn(
          playfairDisplay.className,
          "line-clamp-2 text-[22px] font-extrabold leading-tight tracking-tight text-zinc-900",
        )}
      >
        {item.title}
      </h3>
      {metaParts.length > 0 ? (
        <p className={cn(montserrat.className, "mt-1 text-[12px] text-zinc-500")}>{metaParts.join(" · ")}</p>
      ) : null}
      {item.photoUrls.length > 0 ? (
        <div className="mt-2.5 flex w-full gap-1.5">
          {item.photoUrls.map((url, index) => (
            <div
              key={`${item.id}-photo-${index}`}
              className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-[5px] bg-zinc-200"
            >
              <ImageCoverWithSkeleton src={url} alt="" className="h-full w-full" loading="lazy" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2.5 flex w-full gap-1.5">
          {[0, 1, 2].map((i) => (
            <SegnaSkeletonBlock
              key={`${item.id}-placeholder-${i}`}
              className="aspect-square min-w-0 flex-1"
              rounded="rounded-[5px]"
            />
          ))}
        </div>
      )}
    </Link>
  );
}

export function ProfileItemsCarousel({ items, className }: Props) {
  if (items.length === 0) return null;

  const multi = items.length > 1;
  const slideClass = multi
    ? "w-[88%] max-w-[360px] shrink-0 snap-start"
    : "w-full shrink-0 snap-start";

  return (
    <section className={className}>
      <div
        className={cn(
          "flex w-full min-w-0 max-w-full flex-nowrap touch-pan-x snap-x snap-mandatory scroll-pl-3 gap-3 overflow-x-auto overscroll-x-contain scroll-pr-3 pb-1",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        aria-label="Pièces du membre"
      >
        {items.map((item) => (
          <div key={item.id} className={slideClass}>
            <ProfileCatalogItemFrame item={item} />
          </div>
        ))}
        {multi ? <div className="w-3 shrink-0 snap-start" aria-hidden /> : null}
      </div>
    </section>
  );
}
