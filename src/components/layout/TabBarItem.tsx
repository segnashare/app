"use client";

import Link from "next/link";

import type { MainTab } from "@/components/layout/navigation";
import { cn } from "@/lib/utils/cn";

type TabBarItemProps = {
  tab: MainTab;
  isActive: boolean;
  badge?: number | null;
};

export function TabBarItem({ tab, isActive, badge }: TabBarItemProps) {
  const Icon = tab.icon;
  const hasBadge = typeof badge === "number" ? badge > 0 : Boolean(badge);

  return (
    <Link
      href={tab.href}
      aria-label={tab.label}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "relative flex min-h-[44px] w-full items-center justify-center rounded-2xl px-2 py-2 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        isActive ? "text-white" : "text-white/55 hover:text-white/80",
      )}
    >
      <Icon
        size={22}
        strokeWidth={isActive ? 2.4 : 2}
        className={cn("transition-all", isActive ? "drop-shadow-[0_0_8px_rgba(255,255,255,0.25)]" : "opacity-90")}
      />
      {hasBadge ? (
        <span className="absolute right-[18%] top-[18%] inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
          {typeof badge === "number" && badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </Link>
  );
}
