"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import type { RemoteCoverLoadState } from "@/components/ui/RemoteCoverThumb";
import { GalleryDots } from "@/components/ui/GalleryDots";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { CmsFramePayload, CmsFrameRow } from "@/lib/cms/cms-types";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

/** Distance de scroll (px) depuis le repos pour passer du logo hero → logo épinglé. */
const LOGO_COLLAPSE_RANGE_PX = 120;

function heroImageUrl(payload: CmsFramePayload): string | null {
  if (payload.background?.kind !== "image") return null;
  const img = payload.background.image;
  if (!img) return null;
  const signed = typeof img.signed_url === "string" ? img.signed_url.trim() : "";
  if (signed) return signed;
  return null;
}

function heroVideoUrl(payload: CmsFramePayload): string | null {
  if (payload.background?.kind !== "video") return null;
  const video = payload.background.video;
  if (!video) return null;
  const signed = typeof video.signed_url === "string" ? video.signed_url.trim() : "";
  if (signed) return signed;
  return null;
}

function HeroLogoMark({ logoLabel }: { logoLabel: string }) {
  return (
    <div className="flex w-3/5 max-w-[60%] justify-center">
      {logoLabel ? (
        <p
          className={cn(
            montserrat.className,
            "w-full text-center text-[clamp(1.75rem,11vw,2.75rem)] font-extrabold uppercase leading-none tracking-[0.12em] text-white",
          )}
        >
          {logoLabel}
        </p>
      ) : (
        <Image
          src="/ressources/segna_logo.svg"
          alt="Segna"
          width={300}
          height={85}
          className="h-auto w-full brightness-0 invert"
          priority
        />
      )}
    </div>
  );
}

function HeroAmbientVideo({
  src,
  active = true,
  className,
  onReady,
}: {
  src: string;
  active?: boolean;
  className?: string;
  onReady?: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active) {
      void video.play().catch(() => undefined);
      return;
    }
    video.pause();
    video.currentTime = 0;
  }, [active, src]);

  return (
    <video
      ref={ref}
      src={src}
      className={cn("pointer-events-none h-full w-full object-cover", className)}
      autoPlay
      playsInline
      muted
      loop
      preload="auto"
      aria-hidden
      onLoadedData={() => onReady?.()}
    />
  );
}

function HomeHeroSlide({
  row,
  active = true,
}: {
  row: CmsFrameRow;
  active?: boolean;
}) {
  const payload = row.payload;
  const href = payload.target_url?.trim() || "/shop";
  const title = payload.title?.trim() || "";
  const logoLabel = payload.label?.trim() || "";
  const bgUrl = heroImageUrl(payload);
  const videoUrl = heroVideoUrl(payload);
  const hasMedia = Boolean(bgUrl || videoUrl);

  const [coverState, setCoverState] = useState<RemoteCoverLoadState>(() =>
    hasMedia ? "loading" : "ready",
  );

  useEffect(() => {
    setCoverState(hasMedia ? "loading" : "ready");
  }, [bgUrl, hasMedia, videoUrl]);

  const showContent = !hasMedia || coverState === "ready" || coverState === "failed";

  return (
    <Link
      href={href}
      className="relative block h-[min(75vh,720px)] w-full shrink-0 snap-center snap-always overflow-hidden bg-zinc-900"
      aria-label={title || logoLabel || "Découvrir"}
    >
      {videoUrl ? (
        <div className="pointer-events-none absolute inset-0">
          {coverState === "loading" ? (
            <SegnaSkeletonBlock className="absolute inset-0 z-[2] h-full w-full" rounded="rounded-none" />
          ) : null}
          <HeroAmbientVideo
            src={videoUrl}
            active={active}
            className={cn("absolute inset-0 h-full w-full", coverState === "loading" && "opacity-0")}
            onReady={() => setCoverState("ready")}
          />
        </div>
      ) : bgUrl ? (
        <div className="pointer-events-none absolute inset-0">
          <RemoteCoverThumb
            photoUrl={bgUrl}
            frameClassName="absolute inset-0 h-full w-full"
            photoPosition={payload.background?.image?.position ?? null}
            photoCoverFill
            onLoadStateChange={setCoverState}
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black" aria-hidden />
      )}

      {title ? (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-[4] flex px-6 pb-8",
            !showContent && "invisible",
          )}
        >
          <span
            className={cn(
              montserrat.className,
              "inline-block max-w-[min(100%,320px)] bg-white/95 px-4 py-2.5 text-left text-[15px] font-extrabold uppercase tracking-wide text-zinc-950 shadow-sm",
            )}
          >
            {title}
          </span>
        </div>
      ) : null}
    </Link>
  );
}

type HomeHeroSectionProps = {
  frames: CmsFrameRow[];
};

export function HomeHeroSection({ frames }: HomeHeroSectionProps) {
  const visibleFrames = frames.filter((row) => row.frame_type === "home_hero");
  const sectionRef = useRef<HTMLElement | null>(null);
  const logoAnchorRef = useRef<HTMLDivElement | null>(null);
  const pinnedTopRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const logoWrapRef = useRef<HTMLDivElement | null>(null);
  const restSectionTopRef = useRef<number | null>(null);
  const restNaturalTopRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [logoMotion, setLogoMotion] = useState({
    top: 0,
    scale: 1,
    opacity: 1,
    visible: false,
    ready: false,
  });

  const updateActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || visibleFrames.length <= 1) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    const index = Math.round(el.scrollLeft / width);
    setActiveIndex(Math.max(0, Math.min(index, visibleFrames.length - 1)));
  }, [visibleFrames.length]);

  const updateLogoMotion = useCallback(() => {
    const section = sectionRef.current;
    const anchor = logoAnchorRef.current;
    const pinnedProbe = pinnedTopRef.current;
    if (!section || !anchor || !pinnedProbe) return;

    const sectionRect = section.getBoundingClientRect();
    const naturalTop = anchor.getBoundingClientRect().top;
    const pinnedTop = pinnedProbe.getBoundingClientRect().top;

    if (restSectionTopRef.current === null) {
      restSectionTopRef.current = sectionRect.top;
    }
    if (restNaturalTopRef.current === null) {
      restNaturalTopRef.current = naturalTop;
    }

    const scrollProgress = Math.max(0, restSectionTopRef.current - sectionRect.top);
    const collapse = Math.min(1, scrollProgress / LOGO_COLLAPSE_RANGE_PX);
    const restTop = restNaturalTopRef.current;
    const top = Math.max(pinnedTop, restTop + (pinnedTop - restTop) * collapse);
    const scale = 1 - collapse * 0.5;

    const logoHeight = logoWrapRef.current?.getBoundingClientRect().height ?? 52 * scale;
    const overlap = sectionRect.bottom - top;
    const opacity = Math.max(0, Math.min(1, overlap / Math.max(logoHeight * 0.85, 1)));
    const visible = opacity > 0.02;

    setLogoMotion((prev) => {
      if (
        prev.ready &&
        Math.abs(prev.top - top) < 0.5 &&
        Math.abs(prev.scale - scale) < 0.01 &&
        Math.abs(prev.opacity - opacity) < 0.02 &&
        prev.visible === visible
      ) {
        return prev;
      }
      return { top, scale, opacity, visible, ready: true };
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateActiveIndex, { passive: true });
    return () => el.removeEventListener("scroll", updateActiveIndex);
  }, [updateActiveIndex]);

  useLayoutEffect(() => {
    updateLogoMotion();
  }, [updateLogoMotion]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateLogoMotion);
    };
    const onResize = () => {
      restSectionTopRef.current = null;
      restNaturalTopRef.current = null;
      onScroll();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [updateLogoMotion]);

  if (visibleFrames.length === 0) return null;

  const multi = visibleFrames.length > 1;
  const activeFrame = visibleFrames[activeIndex] ?? visibleFrames[0];
  const activeLogoLabel =
    typeof activeFrame.payload.label === "string" ? activeFrame.payload.label.trim() : "";

  return (
    <>
      <section
        ref={sectionRef}
        aria-label="Mise en avant"
        className="relative -mt-[env(safe-area-inset-top,0px)] w-full pt-[env(safe-area-inset-top,0px)]"
      >
        <div
          ref={logoAnchorRef}
          className="pointer-events-none absolute inset-x-0 top-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.5rem))] z-0 h-px"
          aria-hidden
        />

        <div className="relative">
          <div
            ref={scrollRef}
            className={cn(
              "flex overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              multi && "snap-x snap-mandatory",
            )}
          >
            {visibleFrames.map((row, index) => (
              <div key={row.id} className="w-full min-w-full shrink-0">
                <HomeHeroSlide row={row} active={index === activeIndex} />
              </div>
            ))}
          </div>

          <GalleryDots count={visibleFrames.length} activeIndex={activeIndex} variant="fullscreen" />
        </div>
      </section>

      <div
        ref={pinnedTopRef}
        className="pointer-events-none fixed left-0 top-[max(0.75rem,env(safe-area-inset-top,0px))] z-0 h-px w-px opacity-0"
        aria-hidden
      />

      {logoMotion.ready ? (
        <div
          className={cn(
            "pointer-events-none fixed left-1/2 z-[45] w-full max-w-[430px] motion-reduce:transition-none",
            !logoMotion.visible && "invisible",
          )}
          style={{
            top: `${logoMotion.top}px`,
            transform: `translateX(-50%) scale(${logoMotion.scale})`,
            transformOrigin: "top center",
            opacity: logoMotion.opacity,
          }}
        >
          <div ref={logoWrapRef} className="flex justify-center px-6">
            <HeroLogoMark logoLabel={activeLogoLabel} />
          </div>
        </div>
      ) : null}
    </>
  );
}
