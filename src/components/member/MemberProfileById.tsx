"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const playfairDisplay = segnaPlayfairDisplay;

import { ProfileView, ProfileViewLoadingSkeleton, type ProfileViewData } from "@/components/profile/ProfileView";
import { useProfileViewData } from "@/components/profile/useProfileViewData";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import { cn } from "@/lib/utils/cn";



export function MemberProfileById({ userId }: { userId: string }) {
  const router = useRouter();
  const { data, isLoading } = useProfileViewData(userId, null);
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(92);

  const navigateBack = useCallback(() => {
    router.back();
  }, [router]);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data?.infoCard.displayName, isLoading]);

  const title = data?.infoCard.displayName?.trim() || "Membre";

  return (
    <main className="min-h-[100dvh] bg-white">
      <header
        ref={headerRef}
        className="fixed left-0 right-0 top-0 z-[60] flex justify-center border-b border-zinc-200 bg-white py-6"
      >
        <div className="relative flex min-h-[52px] w-full max-w-[430px] items-center justify-center px-5">
          <button
            type="button"
            onClick={navigateBack}
            className="absolute left-0 top-1/2 z-10 -translate-y-1/2 p-1"
            aria-label="Retour"
          >
            <ChevronLeft className="h-6 w-6 text-zinc-700" />
          </button>
          {isLoading ? (
            <SegnaSkeletonBlock className="mx-12 h-7 w-[min(100%,220px)]" rounded="rounded-lg" />
          ) : (
            <h1
              className={cn(
                playfairDisplay.className,
                "mx-12 max-w-[calc(100%-96px)] break-words text-center text-[20px] font-extrabold italic leading-tight text-zinc-900",
              )}
            >
              {title}
            </h1>
          )}
          <div className="absolute right-0 top-1/2 h-11 w-11 -translate-y-1/2" aria-hidden />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[430px]" style={{ paddingTop: headerHeight }}>
        {isLoading ? (
          <ProfileViewLoadingSkeleton />
        ) : !data ? (
          <div className="px-4 py-8 text-center text-zinc-500">Profil introuvable.</div>
        ) : (
          <ProfileView mode="vue_etrangere" data={data as ProfileViewData} isLoading={false} />
        )}
      </div>
    </main>
  );
}
