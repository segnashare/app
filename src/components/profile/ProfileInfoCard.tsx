"use client";

import { Montserrat } from "next/font/google";
import { Briefcase, Cigarette, Dumbbell, Home, Moon, Wine } from "lucide-react";

import { cn } from "@/lib/utils/cn";

const montserrat = Montserrat({ subsets: ["latin"], weight: "600" });

const INSTAGRAM_ICON_PATH = "/ressources/icons/instagram.svg";

export type ProfileInfoCardData = {
  age: string | null;
  ratingValue?: string | number;
  ratingStars?: number;
  levelIcon?: string | null;
  levelNumber?: number;
  smoking?: boolean;
  alcohol?: boolean;
  sport?: boolean;
  night?: boolean;
  city: string | null;
  profession: string | null;
  instagramHandle: string | null;
  displayName: string | null;
};

type ProfileInfoCardProps = {
  data: ProfileInfoCardData;
  className?: string;
};

const RATING_STARS = 5;
const STAR_ICON_PATH = "/ressources/icons/star.svg";
const CAKE_ICON_PATH = "/ressources/icons/cake.svg";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <img
      src={STAR_ICON_PATH}
      alt=""
      className={cn("h-[18px] w-[18px] shrink-0", filled ? "opacity-100" : "opacity-30")}
      aria-hidden
    />
  );
}

export function ProfileInfoCard({ data, className }: ProfileInfoCardProps) {
  const scrollItems: Array<{ key: string; content: React.ReactNode }> = [];

  if (data.age) {
    scrollItems.push({
      key: "age",
      content: (
        <span className={cn(montserrat.className, "flex items-center gap-2 font-bold text-zinc-900")}>
          <img src={CAKE_ICON_PATH} alt="" className="h-5 w-5 shrink-0" aria-hidden />
          {data.age}
        </span>
      ),
    });
  }

  const stars = Math.min(RATING_STARS, Math.max(0, data.ratingStars ?? 5));
  const ratingDisplay = data.ratingValue ?? "5.0";
  scrollItems.push({
    key: "rating",
    content: (
      <div className="flex items-center gap-2">
        <span className={cn(montserrat.className, "font-bold text-zinc-900")}>{String(ratingDisplay)}</span>
        <div className="flex items-center gap-0.5">
          {Array.from({ length: RATING_STARS }, (_, i) => (
            <StarIcon key={i} filled={i < stars} />
          ))}
        </div>
      </div>
    ),
  });

  const levelNum = data.levelNumber ?? 1;
  if (data.levelIcon || levelNum > 0) {
    scrollItems.push({
      key: "level",
      content: (
        <span className={cn(montserrat.className, "flex items-center gap-2 font-semibold text-zinc-900")}>
          {data.levelIcon ? <span className="text-[20px]">{data.levelIcon}</span> : null}
          <span>Niv. {levelNum}</span>
        </span>
      ),
    });
  }

  scrollItems.push({
    key: "smoking",
    content: (
      <span className={cn("flex items-center gap-1", data.smoking ? "text-zinc-700" : "text-zinc-300")} title={data.smoking ? "Fume" : "Ne fume pas"}>
        <Cigarette className="h-5 w-5" strokeWidth={2} />
      </span>
    ),
  });

  scrollItems.push({
    key: "alcohol",
    content: (
      <span className={cn("flex items-center gap-1", data.alcohol ? "text-zinc-700" : "text-zinc-300")} title={data.alcohol ? "Alcool" : "Pas d'alcool"}>
        <Wine className="h-5 w-5" strokeWidth={2} />
      </span>
    ),
  });

  scrollItems.push({
    key: "sport",
    content: (
      <span className={cn("flex items-center gap-1", data.sport ? "text-zinc-700" : "text-zinc-300")} title={data.sport ? "Sport" : "Pas de sport"}>
        <Dumbbell className="h-5 w-5" strokeWidth={2} />
      </span>
    ),
  });

  scrollItems.push({
    key: "night",
    content: (
      <span className={cn("flex items-center gap-1", data.night ? "text-zinc-700" : "text-zinc-300")} title={data.night ? "Vie nocturne" : "Pas de vie nocturne"}>
        <Moon className="h-5 w-5" strokeWidth={2} />
      </span>
    ),
  });

  return (
    <div
      className={cn(
        "w-full rounded-[10px] border border-zinc-200 bg-white p-5 shadow-sm",
        className,
      )}
    >
      {/* Ligne 1 : éléments scrollables horizontalement avec séparateurs */}
      <div className="overflow-x-auto overflow-y-hidden pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center">
          {scrollItems.map((item, index) => (
            <span key={item.key} className="flex items-center">
              {index > 0 ? (
                <span className="mx-4 w-px shrink-0 self-stretch bg-zinc-200" aria-hidden />
              ) : null}
              <span className="shrink-0">{item.content}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Ligne 2 : ville (user_profiles.city) avec icône maison */}
      {data.city ? (
        <div className="flex items-center gap-4 border-t border-zinc-100 py-4">
          <Home className="h-6 w-6 shrink-0 text-black" strokeWidth={2} />
          <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>{data.city}</span>
        </div>
      ) : null}

      {/* Ligne 3 : icône travail + profession */}
      {data.profession ? (
        <div className="flex items-center gap-4 border-t border-zinc-100 py-4">
          <Briefcase className="h-6 w-6 shrink-0 text-black" strokeWidth={2} />
          <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>{data.profession}</span>
        </div>
      ) : null}

      {/* Ligne 4 : bande Instagram (icône + @handle ou @display_name) */}
      <div className="flex items-center gap-4 border-t border-zinc-100 pt-4 pb-2">
        <img src={INSTAGRAM_ICON_PATH} alt="" className="h-6 w-6 shrink-0" aria-hidden />
        <span className={cn(montserrat.className, "font-semibold text-zinc-900")}>
          {data.instagramHandle?.trim()
            ? (data.instagramHandle.startsWith("@") ? data.instagramHandle : `@${data.instagramHandle}`)
            : data.displayName?.trim()
              ? `@${data.displayName.trim()}`
              : "@"}
        </span>
      </div>
    </div>
  );
}
