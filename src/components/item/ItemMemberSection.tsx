"use client";

import { BadgeCheck } from "lucide-react";
import { Montserrat, Playfair_Display } from "next/font/google";

import { ImageCoverWithSkeleton } from "@/components/ui/ImageCoverWithSkeleton";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });
const playfairDisplay = Playfair_Display({ subsets: ["latin"], weight: ["800"] });

export type ItemMemberSectionData = {
  displayName: string;
  pronouns: string | null;
  isVerified: boolean;
  photoUrls: string[];
  levelIcon: string;
  levelLabel: string;
  levelNumber: number;
  memberSince: string | null;
};

type ItemMemberSectionProps = {
  data: ItemMemberSectionData | null;
  isLoading?: boolean;
  className?: string;
};

export function ItemMemberSection({ data, isLoading, className }: ItemMemberSectionProps) {
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

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm",
          className,
        )}
    >
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
      {data.photoUrls.length > 0 ? (
        <div className="mt-3 flex w-full gap-1.5">
          {data.photoUrls.map((url, index) => (
            <div
              key={index}
              className="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-[5px] bg-zinc-200"
            >
              <ImageCoverWithSkeleton src={url} alt="" className="h-full w-full" loading="lazy" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
