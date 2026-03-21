"use client";

import { useMemo, useState } from "react";

import { CardBase } from "@/components/layout/CardBase";

type BadgeProgressItem = {
  badge_code: string;
  label: string;
  description: string | null;
  icon: string | null;
  current_value: number;
  target_value: number;
  is_completed: boolean;
};

type CommunityBadgesGridProps = {
  badges: BadgeProgressItem[];
};

export function CommunityBadgesGrid({ badges }: CommunityBadgesGridProps) {
  const [openedBadgeCode, setOpenedBadgeCode] = useState<string | null>(null);

  const sortedBadges = useMemo(
    () =>
      [...badges].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed ? -1 : 1;
        if (a.current_value !== b.current_value) return b.current_value - a.current_value;
        return a.label.localeCompare(b.label, "fr");
      }),
    [badges],
  );

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {sortedBadges.map((badge) => {
        const isUnlocked = badge.is_completed;
        const isOpen = openedBadgeCode === badge.badge_code;
        const hasDescription = Boolean(badge.description && badge.description.trim().length > 0);

        return (
          <div key={badge.badge_code} className="relative shrink-0 snap-start">
            {isOpen && hasDescription ? (
              <div className="pointer-events-none absolute -top-2 left-1/2 z-20 w-[154px] -translate-x-1/2 -translate-y-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[11px] leading-tight text-zinc-700 shadow-lg">
                {badge.description}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                if (!hasDescription) return;
                setOpenedBadgeCode((current) => (current === badge.badge_code ? null : badge.badge_code));
              }}
              className="w-full text-left"
              aria-label={hasDescription ? `Voir la description du badge ${badge.label}` : `Badge ${badge.label}`}
            >
              <CardBase className={isUnlocked ? "min-h-[104px] w-[120px] border-[#5E3023] bg-[#F8F1EC] px-2 py-2 text-center" : "min-h-[104px] w-[120px] px-2 py-2 text-center"}>
                <div className="mx-auto flex h-full flex-col items-center justify-center gap-1">
                  <span className="text-[28px] leading-none" style={isUnlocked ? undefined : { filter: "grayscale(1)", opacity: 0.45 }}>
                    {badge.icon ?? "🏅"}
                  </span>
                  <p className={isUnlocked ? "line-clamp-2 text-[11px] font-semibold leading-tight text-zinc-900" : "line-clamp-2 text-[11px] font-medium leading-tight text-zinc-700"}>
                    {badge.label}
                  </p>
                  <p className={isUnlocked ? "text-[10px] leading-none text-[#5E3023]" : "text-[10px] leading-none text-zinc-500"}>
                    {Math.floor(badge.current_value)}/{Math.floor(badge.target_value)}
                  </p>
                </div>
              </CardBase>
            </button>
          </div>
        );
      })}
    </div>
  );
}
