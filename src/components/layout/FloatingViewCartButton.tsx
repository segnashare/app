"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { usePathname } from "next/navigation";

import { shouldShowFloatingCartButton } from "@/components/layout/navigation";
import { usePageChromeHidden } from "@/components/layout/PageChromeLoadingContext";
import {
  FLOATING_BOTTOM_ABOVE_TAB_BAR,
  FLOATING_BOTTOM_WITHOUT_TAB_BAR,
} from "@/components/layout/floating-action-chrome";
import { useActiveCartItemCount } from "@/hooks/useActiveCartItemCount";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const BOTTOM_ABOVE_TAB_BAR = FLOATING_BOTTOM_ABOVE_TAB_BAR;
const BOTTOM_IN_TAB_BAR_SLOT = FLOATING_BOTTOM_WITHOUT_TAB_BAR;

function FloatingViewCartPill({ pathname, count, guideCartOnboarding }: { pathname: string; count: number; guideCartOnboarding: boolean }) {
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

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[48] flex justify-center px-3",
        "motion-reduce:transition-none",
      )}
      style={{
        bottom: tabBarVisible ? BOTTOM_ABOVE_TAB_BAR : BOTTOM_IN_TAB_BAR_SLOT,
        transition: "bottom 250ms ease-out",
      }}
    >
      <Link
        href="/cart"
        aria-label={`Voir le panier, ${count} article${count > 1 ? "s" : ""}`}
        className={cn(
          "segna-guidance-shimmer-target pointer-events-auto inline-flex min-h-[60px] w-[min(50vw,215px)] items-center justify-center gap-1.5 rounded-full bg-black",
          "px-3 py-[18px] text-base leading-tight text-white shadow-[0_10px_28px_rgba(0,0,0,0.28)]",
          guideCartOnboarding && "segna-guidance-shimmer-active",
        )}
      >
        <ShoppingCart className="h-6 w-6 shrink-0" aria-hidden />
        <span className="min-w-0 shrink truncate font-semibold">Voir le panier</span>
        <span aria-hidden className="shrink-0 text-white/75 font-extrabold">
          {"·"}
        </span>
        <span className="shrink-0 tabular-nums font-semibold">{count}</span>
      </Link>
    </div>
  );
}

export function FloatingViewCartButton() {
  const pathname = usePathname();
  const chromeHidden = usePageChromeHidden();
  const canRender = useMemo(() => shouldShowFloatingCartButton(pathname), [pathname]);
  const { count } = useActiveCartItemCount();
  const [guideCartOnboarding, setGuideCartOnboarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("users")
        .select("onboarding_process")
        .eq("id", user.id)
        .maybeSingle<{ onboarding_process?: string | null }>();
      if (!cancelled) setGuideCartOnboarding(data?.onboarding_process === "panier");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (chromeHidden || !canRender || count <= 0) return null;
  if (pathname === "/cart") return null;

  return <FloatingViewCartPill key={pathname} pathname={pathname} count={count} guideCartOnboarding={guideCartOnboarding} />;
}
