"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

export type ItemMemberPhoto = {
  url: string;
  offset: { x: number; y: number };
  zoom: number;
  imageRatio: number;
  /** Ratio w/h du cadre de recadrage (1 = carré profil, 3/4 = looks). */
  cropStageRatio: number;
};

export type ItemMemberSectionData = {
  displayName: string;
  pronouns: string | null;
  isVerified: boolean;
  photos: ItemMemberPhoto[];
  levelIcon: string;
  levelLabel: string;
  levelNumber: number;
  memberSince: string | null;
};

function MemberPhotoThumb({ photo }: { photo: ItemMemberPhoto }) {
  return (
    <RemoteCoverThumb
      photoUrl={photo.url}
      frameClassName="h-full w-full"
      coverStyle={{
        backgroundSize: `${Math.max(100, 100 * (photo.imageRatio / photo.cropStageRatio)) * photo.zoom}%`,
        backgroundPosition: `calc(50% + ${photo.offset.x}%) calc(50% + ${photo.offset.y}%)`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

type ItemMemberSectionProps = {
  data: ItemMemberSectionData | null;
  isLoading?: boolean;
  className?: string;
  profileHref?: string | null;
};

export function ItemMemberSection({ data, isLoading, className, profileHref = null }: ItemMemberSectionProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm",
          className,
        )}
      >
        <SegnaSkeletonBlock className="h-5 w-28" rounded="rounded-md" />
        <div className="mt-3 flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <SegnaSkeletonBlock key={i} className="aspect-square w-20 shrink-0" rounded="rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm",
          className,
        )}
      >
        <p className={cn(montserrat.className, "text-[14px] font-semibold text-zinc-400")}>Section membre</p>
      </div>
    );
  }

  const content = (
    <>
      <div className="flex items-center gap-1.5">
        <h3 className={cn(playfairDisplay.className, "text-[24px] font-extrabold text-zinc-900 tracking-tight")}>{data.displayName}</h3>
        <BadgeCheck
          size={22}
          aria-label={data.isVerified ? "Identité vérifiée" : "Identité non vérifiée"}
          className={cn("shrink-0 transition-colors", data.isVerified ? "text-[#3B82F6]" : "text-zinc-400")}
        />
      </div>
      <p className={cn(montserrat.className, "mt-1 text-[13px] text-zinc-500")}>
        {data.levelIcon}
        {data.memberSince ? ` • Membre Segna depuis ${data.memberSince}` : ""}
      </p>
      {data.pronouns ? (
        <p className={cn(montserrat.className, "mt-1 text-[14px] text-zinc-500")}>{data.pronouns}</p>
      ) : null}
      {data.photos.length > 0 ? (
        <div className="mt-3 flex w-full gap-1.5">
          {data.photos.map((photo, index) => (
            <div
              key={index}
              className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-[5px] bg-zinc-200"
            >
              <MemberPhotoThumb photo={photo} />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );

  const shellClassName = cn(
    "overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm",
    profileHref && "block cursor-pointer transition active:scale-[0.995]",
    className,
  );

  if (profileHref) {
    return (
      <Link
        href={profileHref}
        className={shellClassName}
        aria-label={`Voir le profil de ${data.displayName}`}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={shellClassName}>
      {content}
    </div>
  );
}
