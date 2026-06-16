"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import {
  FLOATING_BOTTOM_ABOVE_TAB_BAR,
  FLOATING_BOTTOM_WITHOUT_TAB_BAR,
} from "@/components/layout/floating-action-chrome";
import type { CommunityFeedMode } from "@/lib/community/types";
import { cn } from "@/lib/utils/cn";

const TABS: { mode: CommunityFeedMode; label: string }[] = [
  { mode: "explorer", label: "Explorer" },
  { mode: "pour_toi", label: "Pour toi" },
];

type CommunityFeedModeToggleProps = {
  mode: CommunityFeedMode;
  onModeChange: (mode: CommunityFeedMode) => void;
};

export function CommunityFeedModeToggle({ mode, onModeChange }: CommunityFeedModeToggleProps) {
  const pathname = usePathname();
  const [tabBarVisible, setTabBarVisible] = useState(true);
  const activeIndex = mode === "pour_toi" ? 1 : 0;

  useEffect(() => {
    const onVisibility = (e: Event) => {
      const ce = e as CustomEvent<{ visible: boolean; pathname: string }>;
      if (ce.detail?.pathname === pathname) {
        setTabBarVisible(ce.detail.visible);
      }
    };
    window.addEventListener("segna:tabbar-visibility", onVisibility);
    return () => window.removeEventListener("segna:tabbar-visibility", onVisibility);
  }, [pathname]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[48] flex justify-center px-3 motion-reduce:transition-none"
      style={{
        bottom: tabBarVisible ? FLOATING_BOTTOM_ABOVE_TAB_BAR : FLOATING_BOTTOM_WITHOUT_TAB_BAR,
        transition: "bottom 250ms ease-out",
      }}
    >
      <div
        className="pointer-events-auto relative w-[min(78vw,300px)] rounded-full border border-white bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
        role="tablist"
        aria-label="Fil communauté"
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-zinc-900 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        />

        <div className="relative grid grid-cols-2">
          {TABS.map((tab) => {
            const active = mode === tab.mode;
            return (
              <button
                key={tab.mode}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={tab.mode === "explorer" ? "Explorer" : "Pour toi"}
                onClick={() => onModeChange(tab.mode)}
                className={cn(
                  "relative z-10 flex min-h-[44px] items-center justify-center rounded-full px-4 py-2 transition-colors duration-300 motion-reduce:transition-none",
                  active ? "text-white" : "text-zinc-900",
                )}
              >
                {tab.mode === "explorer" ? (
                  <Image
                    src="/ressources/segna_logo.svg"
                    alt=""
                    width={78}
                    height={20}
                    className={cn("h-5 w-auto", active && "brightness-0 invert")}
                  />
                ) : (
                  <span className="text-[13px] font-bold uppercase tracking-[0.08em]">Pour toi</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
