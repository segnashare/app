"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";

import { shouldShowMemberFeedbackFab, shouldShowTabBar } from "@/components/layout/navigation";
import {
  FLOATING_BOTTOM_ABOVE_TAB_BAR,
  FLOATING_BOTTOM_WITHOUT_TAB_BAR,
  FLOATING_ROUND_ACTION_SHELL_CLASS,
} from "@/components/layout/floating-action-chrome";
import { openMemberFeedbackModal } from "@/lib/feedback/open-member-feedback-modal";
import { isMemberFeedbackFabEnabled } from "@/lib/feedback/member-feedback-fab-enabled";

const BOTTOM_ABOVE_TAB_BAR = FLOATING_BOTTOM_ABOVE_TAB_BAR;
const BOTTOM_WITHOUT_TAB_BAR = FLOATING_BOTTOM_WITHOUT_TAB_BAR;

export function MemberFeedbackFab() {
  const pathname = usePathname();
  const enabled = useMemo(() => isMemberFeedbackFabEnabled(), []);
  const canRender = useMemo(
    () => enabled && shouldShowMemberFeedbackFab(pathname),
    [enabled, pathname],
  );
  const hasTabBar = useMemo(() => shouldShowTabBar(pathname), [pathname]);
  const [tabBarVisible, setTabBarVisible] = useState(true);

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

  if (!canRender) return null;

  return (
    <div
      className="pointer-events-none fixed right-3 z-[47] flex max-w-[430px] justify-end motion-reduce:transition-none md:right-[max(12px,calc((100vw-430px)/2+12px))]"
      style={{
        bottom: hasTabBar && tabBarVisible ? BOTTOM_ABOVE_TAB_BAR : BOTTOM_WITHOUT_TAB_BAR,
        transition: "bottom 250ms ease-out",
      }}
    >
      <button
        type="button"
        onClick={openMemberFeedbackModal}
        aria-label="Signaler un problème ou poser une question"
        className={FLOATING_ROUND_ACTION_SHELL_CLASS}
      >
        <MessageCircle className="h-7 w-7" strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
