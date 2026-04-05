"use client";

import Link from "next/link";
import { Montserrat } from "next/font/google";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import type { RemoteCoverLoadState } from "@/components/ui/RemoteCoverThumb";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { CmsFramePayload, CmsFrameRow, CmsFrameType } from "@/lib/cms/cms-types";
import { cn } from "@/lib/utils/cn";

const montserratLinkCardTitle = Montserrat({
  subsets: ["latin"],
  weight: "700",
});

/** Par défaut : blanc (Montserrat gras). Seul `title_color: "black"` force le noir. */
function linkCardTitleClassName(payload: CmsFramePayload): string {
  return payload.title_color === "black" ? "text-zinc-900" : "text-white";
}

function imageUrlFromPayload(img: { storage_path?: string; signed_url?: string } | undefined): string | null {
  if (!img) return null;
  if (typeof img.signed_url === "string" && img.signed_url.trim()) return img.signed_url.trim();
  return null;
}

function backgroundLayerClass(payload: CmsFramePayload): string {
  const bg = payload.background;
  if (!bg || bg.kind === "none") return "bg-zinc-50";
  if (bg.kind === "gradient" && bg.gradient_classes?.trim()) {
    return cn("bg-gradient-to-br", bg.gradient_classes.trim());
  }
  if (bg.kind === "solid" && bg.solid_hex?.trim()) return "";
  if (bg.kind === "image") return "";
  return "bg-zinc-50";
}

function backgroundSolidStyle(payload: CmsFramePayload): CSSProperties | undefined {
  const bg = payload.background;
  if (bg?.kind === "solid" && bg.solid_hex?.trim()) {
    return { backgroundColor: bg.solid_hex.trim() };
  }
  return undefined;
}

function OfferCardInner({ payload }: { payload: CmsFramePayload }) {
  const href = payload.target_url?.trim() || "/shop";
  const bgUrl =
    payload.background?.kind === "image"
      ? imageUrlFromPayload(payload.background.image)
      : null;
  const title = payload.title?.trim() || "Sans titre";
  const subtitle = payload.subtitle?.trim() || "";
  const cta = payload.cta_label?.trim() || "Découvrir →";

  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[120px] w-[min(240px,calc(100vw-4rem))] shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 p-4 shadow-sm",
        !bgUrl ? backgroundLayerClass(payload) : "bg-zinc-100",
      )}
      style={!bgUrl ? backgroundSolidStyle(payload) : undefined}
    >
      {bgUrl ? (
        <div className="pointer-events-none absolute inset-0 z-0">
          <RemoteCoverThumb
            photoUrl={bgUrl}
            frameClassName="absolute inset-0 h-full w-full"
            photoPosition={payload.background?.image?.position ?? null}
          />
          <div className="absolute inset-0 bg-white/55" />
        </div>
      ) : null}
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <p className="text-[15px] font-semibold leading-snug text-zinc-900">{title}</p>
        {subtitle ? <p className="mt-1 text-[13px] leading-snug text-zinc-600">{subtitle}</p> : null}
        <span className="mt-3 inline-flex text-xs font-semibold text-[#5E3023]">{cta}</span>
      </div>
    </Link>
  );
}

/** Grande carte hub (titre + lien + fond), réutilisable hors scroll horizontal générique. */
export function ShopWideLinkCardBlock({
  payload,
  aspectClassName,
  wrapperClassName,
  onNavigate,
}: {
  payload: CmsFramePayload;
  aspectClassName: string;
  wrapperClassName?: string;
  onNavigate?: () => void;
}) {
  const href = payload.target_url?.trim() || "/shop";
  const title = payload.title?.trim() || "Découvrir";
  const bgUrl =
    payload.background?.kind === "image"
      ? imageUrlFromPayload(payload.background.image)
      : null;

  const [coverState, setCoverState] = useState<RemoteCoverLoadState>(() => (bgUrl ? "loading" : "ready"));
  useEffect(() => {
    setCoverState(bgUrl ? "loading" : "ready");
  }, [bgUrl]);

  const showTitle = !bgUrl || coverState === "ready" || coverState === "failed";
  const fullCardShimmer = Boolean(bgUrl) && coverState === "loading";

  return (
    <Link href={href} className={wrapperClassName} onClick={onNavigate}>
      <div
        className={cn(
          "relative flex flex-col justify-start overflow-hidden rounded-2xl p-4 text-left shadow-sm",
          aspectClassName,
          !bgUrl ? backgroundLayerClass(payload) : "bg-zinc-100",
        )}
        style={!bgUrl ? backgroundSolidStyle(payload) : undefined}
      >
        {bgUrl ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-0">
              <RemoteCoverThumb
                photoUrl={bgUrl}
                frameClassName="absolute inset-0 h-full w-full"
                photoPosition={payload.background?.image?.position ?? null}
                onLoadStateChange={setCoverState}
              />
            </div>
            {fullCardShimmer ? (
              <SegnaSkeletonBlock
                className="pointer-events-none absolute inset-0 z-[3]"
                rounded="rounded-2xl"
              />
            ) : null}
          </>
        ) : null}
        <p
          className={cn(
            "relative z-[2] text-[1.65rem] leading-tight",
            montserratLinkCardTitle.className,
            linkCardTitleClassName(payload),
            !showTitle && "invisible",
          )}
        >
          {title}
        </p>
      </div>
    </Link>
  );
}

function CategoryCapsuleInner({ payload }: { payload: CmsFramePayload }) {
  const href = payload.target_url?.trim() || "/shop";
  const label = payload.label?.trim();
  const title = payload.title?.trim() || "Sans titre";
  const inset = payload.inset_image;
  const insetUrl = imageUrlFromPayload(inset);

  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[112px] w-[min(200px,calc(100vw-5rem))] shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 p-4 text-left shadow-sm",
        backgroundLayerClass(payload),
      )}
      style={backgroundSolidStyle(payload)}
    >
      {payload.background?.kind === "image" && !insetUrl ? (
        <div className="pointer-events-none absolute inset-0 z-0 opacity-90">
          {imageUrlFromPayload(payload.background.image) ? (
            <RemoteCoverThumb
              photoUrl={imageUrlFromPayload(payload.background.image)!}
              frameClassName="absolute inset-0 h-full w-full"
              photoPosition={payload.background.image?.position ?? null}
            />
          ) : null}
        </div>
      ) : null}
      <div className="relative z-[1] flex flex-1 flex-col">
        {label ? <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{label}</p> : null}
        <p className={cn("font-bold text-zinc-900", label ? "mt-1 text-[20px] leading-tight" : "text-[20px] leading-tight")}>
          {title}
        </p>
        {insetUrl ? (
          <div className="mt-2 h-16 w-full overflow-hidden rounded-lg">
            <RemoteCoverThumb
              photoUrl={insetUrl}
              frameClassName="h-full w-full"
              photoPosition={inset?.position ?? null}
            />
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function PromoAdInner({ payload }: { payload: CmsFramePayload }) {
  const href = payload.target_url?.trim() || "/shop";
  const header = payload.header?.trim();
  const title = payload.title?.trim() || "";
  const button = payload.button_label?.trim() || "Découvrir";
  const bgUrl =
    payload.background?.kind === "image" ? imageUrlFromPayload(payload.background.image) : null;
  const dark = payload.background?.kind === "solid" && payload.background.solid_hex?.toLowerCase() === "#000000";

  return (
    <Link
      href={href}
      className={cn(
        "relative flex w-full flex-col overflow-hidden rounded-2xl px-4 py-4 text-left shadow-sm",
        !bgUrl ? backgroundLayerClass(payload) : "",
        dark ? "text-white" : "text-zinc-900",
      )}
      style={!bgUrl ? backgroundSolidStyle(payload) : { backgroundColor: "#0a0a0a" }}
    >
      {bgUrl ? (
        <div className="pointer-events-none absolute inset-0 z-0">
          <RemoteCoverThumb
            photoUrl={bgUrl}
            frameClassName="absolute inset-0 h-full w-full"
            photoPosition={payload.background?.image?.position ?? null}
          />
          <div className="absolute inset-0 bg-black/45" />
        </div>
      ) : null}
      <div className="relative z-[1] flex flex-col gap-2">
        {header ? <p className={cn("text-[12px] font-medium", dark || bgUrl ? "text-zinc-300" : "text-zinc-500")}>{header}</p> : null}
        {title ? <p className="text-[20px] font-bold leading-snug">{title}</p> : null}
        <span className="mt-2 inline-flex w-fit rounded-full bg-white px-4 py-2 text-[13px] font-bold text-zinc-900">{button}</span>
      </div>
    </Link>
  );
}

function EditorialCardInner({ payload }: { payload: CmsFramePayload }) {
  const href = payload.target_url?.trim() || "/shop";
  const label = payload.label?.trim();
  const title = payload.title?.trim() || "";
  const body = payload.body?.trim();
  const cta = payload.cta_label?.trim() || "Découvrir →";

  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[100px] w-[min(260px,calc(100vw-4rem))] shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 p-4 shadow-sm",
        backgroundLayerClass(payload),
      )}
      style={backgroundSolidStyle(payload)}
    >
      {payload.background?.kind === "image" && imageUrlFromPayload(payload.background.image) ? (
        <div className="pointer-events-none absolute inset-0 z-0 opacity-30">
          <RemoteCoverThumb
            photoUrl={imageUrlFromPayload(payload.background.image)!}
            frameClassName="absolute inset-0 h-full w-full"
            photoPosition={payload.background.image?.position ?? null}
          />
        </div>
      ) : null}
      <div className="relative z-[1] flex flex-col">
        {label ? <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{label}</p> : null}
        {title ? <p className={cn("font-bold text-zinc-900", label ? "mt-1 text-[17px]" : "text-[17px]")}>{title}</p> : null}
        {body ? <p className="mt-1 text-[13px] leading-snug text-zinc-600">{body}</p> : null}
        <span className="mt-3 inline-flex text-xs font-semibold text-[#5E3023]">{cta}</span>
      </div>
    </Link>
  );
}

function renderByType(type: CmsFrameType, payload: CmsFramePayload) {
  switch (type) {
    case "offer_card":
      return <OfferCardInner payload={payload} />;
    case "category_capsule":
      return <CategoryCapsuleInner payload={payload} />;
    case "promo_ad":
      return <PromoAdInner payload={payload} />;
    case "editorial_card":
      return <EditorialCardInner payload={payload} />;
    case "shop_item_ref":
    case "shop_category_ref":
    case "shop_brand_ref":
    case "shop_link_card":
      return null;
    default:
      return null;
  }
}

export function CmsFrameItem({ row }: { row: CmsFrameRow }) {
  return renderByType(row.frame_type, row.payload);
}

export function CmsHorizontalScrollRow({ rows, className }: { rows: CmsFrameRow[]; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <div
      className={cn(
        "-mx-5 mt-3 flex gap-3 overflow-x-auto overflow-y-hidden pb-1 touch-pan-x px-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {rows.map((row) => (
        <CmsFrameItem key={row.id} row={row} />
      ))}
    </div>
  );
}
