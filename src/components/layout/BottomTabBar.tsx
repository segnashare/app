"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { MAIN_TABS, shouldShowTabBar } from "@/components/layout/navigation";
import { TabBarItem } from "@/components/layout/TabBarItem";
import { cn } from "@/lib/utils/cn";

const SCROLL_THRESHOLD_PX = 18;
const TOP_SNAP_PX = 8;

export function BottomTabBar() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const accumulatedDeltaRef = useRef(0);
  const tickingRef = useRef(false);

  const canRender = useMemo(() => shouldShowTabBar(pathname), [pathname]);

  useEffect(() => {
    if (!canRender) return;

    const updateFromScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollYRef.current;
      lastScrollYRef.current = currentY;

      if (currentY <= TOP_SNAP_PX) {
        accumulatedDeltaRef.current = 0;
        setIsVisible(true);
        return;
      }

      if (Math.abs(delta) < 2) return;

      if (Math.sign(delta) !== Math.sign(accumulatedDeltaRef.current)) {
        accumulatedDeltaRef.current = 0;
      }
      accumulatedDeltaRef.current += delta;

      if (accumulatedDeltaRef.current > SCROLL_THRESHOLD_PX) {
        setIsVisible(false);
        accumulatedDeltaRef.current = 0;
      } else if (accumulatedDeltaRef.current < -SCROLL_THRESHOLD_PX) {
        setIsVisible(true);
        accumulatedDeltaRef.current = 0;
      }
    };

    const onScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      window.requestAnimationFrame(() => {
        updateFromScroll();
        tickingRef.current = false;
      });
    };

    lastScrollYRef.current = window.scrollY;
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [canRender]);

  useEffect(() => {
    if (!canRender) return;
    window.dispatchEvent(
      new CustomEvent("segna:tabbar-visibility", {
        detail: { visible: isVisible, pathname },
      }),
    );
  }, [canRender, isVisible, pathname]);

  if (!canRender) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-0 pb-0 transition-transform duration-250 ease-out",
        "md:px-3 md:pb-[calc(env(safe-area-inset-bottom)+8px)]",
        "motion-reduce:transition-none",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0",
      )}
    >
      <nav
        aria-label="Navigation principale"
        className={cn(
          "pointer-events-auto flex h-[calc(56px+env(safe-area-inset-bottom))] w-full max-w-[430px] items-center border-0 bg-black px-2 pb-[env(safe-area-inset-bottom)] pt-1 text-white",
          "md:mb-3 md:h-16 md:rounded-2xl md:border md:border-zinc-700 md:pb-0 md:pt-0 md:shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
        )}
      >
        {MAIN_TABS.map((tab) => (
          <TabBarItem key={tab.id} tab={tab} isActive={pathname === tab.href} />
        ))}
      </nav>
    </div>
  );
}
