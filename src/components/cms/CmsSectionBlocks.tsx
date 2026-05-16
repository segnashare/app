"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

import type { RemoteCoverLoadState } from "@/components/ui/RemoteCoverThumb";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { CmsFramePayload, CmsFrameRow } from "@/lib/cms/cms-types";
import { pickPseudoFrame } from "@/lib/cms/cms-pseudo-frame";
import { renderCmsStarBoldSegments } from "@/lib/cms/render-cms-star-bold";
import { departmentSlugForCategoryId } from "@/lib/shop/shop-department-categories";
import { cn } from "@/lib/utils/cn";

import type { CmsShopHubFramesEnv } from "@/components/cms/CmsShopHubFramesContext";
import { useCmsShopHubFramesOptional } from "@/components/cms/CmsShopHubFramesContext";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";

/** Hero « Obtenir plus » — ratio Figma 500×350 (aligné crop BO + aperçu). */
const CMS_PROFILE_PLUS_HERO_ASPECT_CLASS = "aspect-[500/350]";

/** Libellé CMS du hero (ex. « Segna X ») : afficher le mot-clé typographique « SegnaX ». */
function profilePlusHeroIsSegnaXKicker(kicker: string): boolean {
  return /^segna\s*x$/i.test(kicker.trim());
}

const montserratLinkCardTitle = segnaMontserrat;
const montserratWideCardCta = segnaMontserrat;

export type CmsFrameLayoutMode = "hub" | "stack";

const CmsFrameLayoutModeContext = createContext<CmsFrameLayoutMode>("hub");

export function CmsFrameLayoutModeProvider({ mode, children }: { mode: CmsFrameLayoutMode; children: ReactNode }) {
  return <CmsFrameLayoutModeContext.Provider value={mode}>{children}</CmsFrameLayoutModeContext.Provider>;
}

export function useCmsFrameLayoutMode(): CmsFrameLayoutMode {
  return useContext(CmsFrameLayoutModeContext);
}

/** Accent des libellés CTA sur les petites cartes CMS (ex. offre / éditorial en mode stack). */
export type CmsLinkCardCtaTone = "brand" | "neutral";

const CmsLinkCardCtaToneContext = createContext<CmsLinkCardCtaTone>("brand");

export function CmsLinkCardCtaToneProvider({ tone, children }: { tone: CmsLinkCardCtaTone; children: ReactNode }) {
  return <CmsLinkCardCtaToneContext.Provider value={tone}>{children}</CmsLinkCardCtaToneContext.Provider>;
}

function useCmsLinkCardCtaTone(): CmsLinkCardCtaTone {
  return useContext(CmsLinkCardCtaToneContext);
}

function cmsLinkCardCtaClassName(tone: CmsLinkCardCtaTone): string {
  return tone === "neutral" ? "text-zinc-900" : "text-[#5E3023]";
}

/**
 * Gabarit des grandes cartes hub CMS (`shop_link_card`, offres, éditos…).
 * Plus étroit que les cartes split (`SHOP_HUB_SPOTLIGHT_ITEM_RAIL_OUTER_CLASS`) pour accentuer
 * l’aperçu de la frame suivante sur petits écrans. Plafond 410px (colonne app `max-w-[430px]`).
 */
export const CMS_SHOP_HUB_FRAME_OUTER_CLASS =
  "w-[min(84vw,410px)] max-w-[410px] shrink-0 snap-start";

/**
 * Rails pièces split hub (À découvrir, bons coups…) : même largeur que le rail Catégories
 * pour laisser voir l’aperçu de la frame suivante sur petits écrans.
 */
export const SHOP_HUB_SPOTLIGHT_ITEM_RAIL_OUTER_CLASS =
  "w-[min(88vw,410px)] max-w-[410px] shrink-0 snap-start";

/**
 * Gabarit large (rail « Prêts », panier vide Échange, etc.) : **`w-full`** dans la zone utile
 * (`section` / rail avec `px-5`, colonne max 430px), plafonné à 520px. Même largeur que le panier vide
 * en stack — évite `94vw` (viewport) plus étroit que la colonne et désaligné à droite.
 */
export const CMS_SHOP_HUB_FRAME_WIDE_STACK_OUTER_CLASS = "w-full max-w-[520px] shrink-0 snap-start";

/** Alias du gabarit large (rails horizontaux CMS type Prêts). */
export const CMS_SHOP_HUB_FRAME_WIDE_OUTER_CLASS = CMS_SHOP_HUB_FRAME_WIDE_STACK_OUTER_CLASS;

const CmsHubFrameOuterClassContext = createContext<string | null>(null);

function useCmsHubFrameOuterClass(): string {
  const v = useContext(CmsHubFrameOuterClassContext);
  return v ?? CMS_SHOP_HUB_FRAME_OUTER_CLASS;
}

/** Fusion section Prêts Échange : promo `promo_ad` sans titre ni CTA (image seule). */
const CmsPromoVisualOnlyContext = createContext(false);

function useCmsPromoVisualOnly(): boolean {
  return useContext(CmsPromoVisualOnlyContext);
}

/**
 * Largeur des cartes hub quand un parent a posé `hubFrameOuterClass` (`CmsHorizontalScrollRow`, etc.).
 * `null` sinon — ex. `ShopCapsuleItemRefFrame` garde alors ses largeurs rail catalogue (`88vw` / 48 %).
 */
export function useCmsHubFrameOuterOverride(): string | null {
  return useContext(CmsHubFrameOuterClassContext);
}

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

/**
 * Rails hub boutique / panier : `promo_ad`, `offer_card`, `editorial_card` partagent le même gabarit
 * que `shop_link_card` (section `shop_home_capsules` 2ᵉ rail, « Nos offres », etc.).
 */
function hubWidePayloadFromOffer(p: CmsFramePayload): CmsFramePayload {
  const title = [p.title?.trim(), p.subtitle?.trim()].filter(Boolean).join("\n");
  return {
    ...p,
    title,
    cta_label: p.cta_label?.trim() || "Découvrir →",
    cta_pill: true,
    title_color: "white",
  };
}

function hubWidePayloadFromPromo(p: CmsFramePayload): CmsFramePayload {
  return {
    ...p,
    /** Image + pastille uniquement (pas de surimpression titre / header). */
    title: "",
    cta_label: p.button_label?.trim() || p.cta_label?.trim() || "Découvrir",
    cta_pill: true,
    title_color: "white",
  };
}

function hubWidePayloadFromEditorial(p: CmsFramePayload): CmsFramePayload {
  const title = [p.label?.trim(), p.title?.trim(), p.body?.trim()].filter(Boolean).join("\n");
  return {
    ...p,
    title,
    cta_label: p.cta_label?.trim() || "Découvrir →",
    cta_pill: true,
    title_color: "white",
  };
}

function OfferCardInner({ payload }: { payload: CmsFramePayload }) {
  const layout = useCmsFrameLayoutMode();
  const linkCtaTone = useCmsLinkCardCtaTone();
  const hubOuter = useCmsHubFrameOuterClass();
  if (layout === "hub") {
    return (
      <div className={hubOuter}>
        <ShopWideLinkCardBlock
          payload={hubWidePayloadFromOffer(payload)}
          aspectClassName="aspect-[2.32]"
          wrapperClassName="block w-full rounded-2xl"
        />
      </div>
    );
  }

  const href = payload.target_url?.trim() || "/shop";
  const bgUrl =
    payload.background?.kind === "image"
      ? imageUrlFromPayload(payload.background.image)
      : null;
  const title = payload.title?.trim() || "";
  const subtitle = payload.subtitle?.trim() || "";
  const cta = payload.cta_label?.trim() || "Découvrir →";

  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[120px] shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 p-4 shadow-sm",
        layout === "stack" ? "w-full max-w-none min-w-0" : "w-[min(240px,calc(100vw-4rem))]",
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
        {title ? <p className="text-[15px] font-semibold leading-snug text-zinc-900">{title}</p> : null}
        {subtitle ? <p className="mt-1 text-[13px] leading-snug text-zinc-600">{subtitle}</p> : null}
        <span className={cn("mt-3 inline-flex text-xs font-semibold", cmsLinkCardCtaClassName(linkCtaTone))}>{cta}</span>
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
  visualOnly = false,
  /** Hors navigation (ex. bannière décorative dans une carte parrainage). */
  asStatic = false,
  /** Coins de la surface (et du shimmer image) — défaut aligné catalogue `rounded-2xl`, hero profil `rounded-3xl`. */
  surfaceRadiusClassName = "rounded-2xl",
}: {
  payload: CmsFramePayload;
  aspectClassName: string;
  wrapperClassName?: string;
  onNavigate?: () => void;
  /** Image pleine carte, pas de titre / CTA / overlay sombre (promo fusionnée Prêts). */
  visualOnly?: boolean;
  asStatic?: boolean;
  surfaceRadiusClassName?: string;
}) {
  const layout = useCmsFrameLayoutMode();
  const href = payload.target_url?.trim() || "/shop";
  const title = payload.title?.trim() || "";
  const pill = payload.cta_pill === true;
  const ctaText = payload.cta_label?.trim() || "Découvrir";
  const bgUrl =
    payload.background?.kind === "image"
      ? imageUrlFromPayload(payload.background.image)
      : null;

  const [coverState, setCoverState] = useState<RemoteCoverLoadState>(() => (bgUrl ? "loading" : "ready"));
  useEffect(() => {
    setCoverState(bgUrl ? "loading" : "ready");
  }, [bgUrl]);

  const showTitle = Boolean(title) && !visualOnly && (!bgUrl || coverState === "ready" || coverState === "failed");
  const fullCardShimmer = Boolean(bgUrl) && coverState === "loading";
  const showPillOverlay = pill && !visualOnly;
  /** En stack, sans `visualOnly`, on garde une hauteur souple ; bannière décorative = ratio imposé par l’appelant. */
  const surfaceAspectClass =
    visualOnly ? aspectClassName : layout === "stack" ? "aspect-auto min-h-[148px]" : aspectClassName;

  const shellClass = cn(
    "not-italic",
    layout === "stack" ? "block w-full max-w-none" : undefined,
    wrapperClassName,
  );

  const surface = (
    <div
      className={cn(
        "shop-wide-link-card-surface relative flex min-h-0 flex-col overflow-hidden text-left shadow-sm",
        surfaceRadiusClassName,
        visualOnly ? "p-0" : "p-4",
        pill && !visualOnly ? "justify-between" : "justify-start",
        surfaceAspectClass,
        !bgUrl ? backgroundLayerClass(payload) : "bg-zinc-900",
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
              photoCoverFill
              onLoadStateChange={setCoverState}
            />
          </div>
          {showPillOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-[1] bg-black/35" aria-hidden />
          ) : null}
          {fullCardShimmer ? (
            <SegnaSkeletonBlock className="pointer-events-none absolute inset-0 z-[3]" rounded={surfaceRadiusClassName} />
          ) : null}
        </>
      ) : null}
      {!visualOnly ? (
        <div
          className={cn(
            "relative z-[2] flex min-h-0 flex-1 flex-col",
            pill ? "justify-between" : "justify-start",
          )}
        >
          {showTitle ? (
            <p
              className={cn(
                "whitespace-pre-line text-[22px] font-bold not-italic leading-tight",
                montserratLinkCardTitle.className,
                linkCardTitleClassName(payload),
              )}
            >
              {title}
            </p>
          ) : null}
          {pill ? (
            <span
              className={cn(
                "segna-guidance-shimmer-target mt-3 inline-block w-fit max-w-full whitespace-pre-wrap rounded-full bg-white px-4 py-2 text-left text-[14px] font-semibold not-italic leading-snug text-zinc-900",
                montserratWideCardCta.className,
              )}
            >
              {renderCmsStarBoldSegments(ctaText, "wide-link-cta")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (asStatic) {
    return (
      <div className={shellClass} role="img" aria-label={title.trim() ? title : "Visuel d’invitation"}>
        {surface}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={shellClass}
      onClick={onNavigate}
      aria-label={
        visualOnly
          ? (title || "Découvrir")
          : !visualOnly && !title && pill && ctaText
            ? ctaText
            : undefined
      }
    >
      {surface}
    </Link>
  );
}

function CategoryCapsuleInner({ payload }: { payload: CmsFramePayload }) {
  const layout = useCmsFrameLayoutMode();
  const href = payload.target_url?.trim() || "/shop";
  const label = payload.label?.trim();
  const title = payload.title?.trim() || "";
  const inset = payload.inset_image;
  const insetUrl = imageUrlFromPayload(inset);

  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[112px] shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 p-4 text-left shadow-sm",
        layout === "stack" ? "w-full max-w-none min-w-0" : "w-[min(200px,calc(100vw-5rem))]",
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
        {title ? (
          <p className={cn("font-bold text-zinc-900", label ? "mt-1 text-[20px] leading-tight" : "text-[20px] leading-tight")}>
            {title}
          </p>
        ) : null}
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
  const layout = useCmsFrameLayoutMode();
  const hubOuter = useCmsHubFrameOuterClass();
  const visualOnly = useCmsPromoVisualOnly();

  if (layout === "hub") {
    return (
      <div className={hubOuter}>
        <ShopWideLinkCardBlock
          payload={hubWidePayloadFromPromo(payload)}
          aspectClassName="aspect-[2.32]"
          wrapperClassName="block w-full rounded-2xl"
          visualOnly={visualOnly}
        />
      </div>
    );
  }

  if (visualOnly) {
    const href = payload.target_url?.trim() || "/shop";
    const bgUrl =
      payload.background?.kind === "image" ? imageUrlFromPayload(payload.background.image) : null;
    const label = [payload.header?.trim(), payload.title?.trim()].filter(Boolean).join(" — ") || "Découvrir";
    return (
      <Link
        href={href}
        className="relative block w-full overflow-hidden rounded-2xl shadow-sm aspect-[2.32] not-italic"
        aria-label={label}
      >
        {bgUrl ? (
          <RemoteCoverThumb
            photoUrl={bgUrl}
            frameClassName="absolute inset-0 h-full w-full"
            photoPosition={payload.background?.image?.position ?? null}
          />
        ) : (
          <div
            className={cn("h-full min-h-[148px] w-full", backgroundLayerClass(payload))}
            style={backgroundSolidStyle(payload)}
          />
        )}
      </Link>
    );
  }

  const href = payload.target_url?.trim() || "/shop";
  const button = payload.button_label?.trim() || "Découvrir";
  const bgUrl =
    payload.background?.kind === "image" ? imageUrlFromPayload(payload.background.image) : null;
  const dark = payload.background?.kind === "solid" && payload.background.solid_hex?.toLowerCase() === "#000000";

  return (
    <Link
      href={href}
      aria-label={button}
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
      <div
        className={cn(
          "relative z-[1] flex min-h-[120px] flex-1 flex-col",
          bgUrl ? "justify-end" : "justify-start gap-2",
        )}
      >
        <span className="inline-flex w-fit rounded-full bg-white px-4 py-2 text-[13px] font-bold text-zinc-900">{button}</span>
      </div>
    </Link>
  );
}

function EditorialCardInner({ payload }: { payload: CmsFramePayload }) {
  const layout = useCmsFrameLayoutMode();
  const linkCtaTone = useCmsLinkCardCtaTone();
  const hubOuter = useCmsHubFrameOuterClass();
  if (layout === "hub") {
    return (
      <div className={hubOuter}>
        <ShopWideLinkCardBlock
          payload={hubWidePayloadFromEditorial(payload)}
          aspectClassName="aspect-[2.32]"
          wrapperClassName="block w-full rounded-2xl"
        />
      </div>
    );
  }

  const href = payload.target_url?.trim() || "/shop";
  const label = payload.label?.trim();
  const title = payload.title?.trim() || "";
  const body = payload.body?.trim();
  const cta = payload.cta_label?.trim() || "Découvrir →";

  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-[100px] shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/80 p-4 shadow-sm",
        layout === "stack" ? "w-full max-w-none min-w-0" : "w-[min(260px,calc(100vw-4rem))]",
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
        <span className={cn("mt-3 inline-flex text-xs font-semibold", cmsLinkCardCtaClassName(linkCtaTone))}>{cta}</span>
      </div>
    </Link>
  );
}

function cmsRefOuterClass(layout: CmsFrameLayoutMode, hubOuter: string): string {
  return layout === "stack"
    ? "block w-full max-w-none shrink-0 snap-start rounded-2xl text-left"
    : cn(hubOuter, "rounded-2xl text-left");
}

function CmsShopCategoryRefFrame({ row, hub }: { row: CmsFrameRow; hub: CmsShopHubFramesEnv | null }) {
  const layout = useCmsFrameLayoutMode();
  const hubOuter = useCmsHubFrameOuterClass();
  const p = row.payload;
  const id = typeof p.category_id === "string" ? p.category_id.trim() : "";
  const cats = hub?.categories ?? [];
  const cat = id ? cats.find((c) => c.id === id) : undefined;
  const label = cat?.label ?? "Catégorie";
  const deptSlug = id ? departmentSlugForCategoryId(id, cats) : null;
  const pseudo = pickPseudoFrame(`cms-cat-${row.id}`);
  const card = (
    <div
      className={cn(
        "flex aspect-[2.32] flex-col justify-end rounded-2xl bg-gradient-to-br p-4 text-zinc-900",
        pseudo.color,
      )}
    >
      <p className="text-[1.65rem] font-bold leading-tight text-zinc-900">{label}</p>
    </div>
  );

  if (hub && id && !hub.refsPreferShopNavigation) {
    return (
      <button type="button" className={cmsRefOuterClass(layout, hubOuter)} onClick={() => hub.onCategoryFilter(id)}>
        {card}
      </button>
    );
  }

  const href = deptSlug ? `/shop/${deptSlug}` : "/shop";
  return (
    <Link href={href} className={cn(cmsRefOuterClass(layout, hubOuter), "block")}>
      {card}
    </Link>
  );
}

function CmsShopBrandRefFrame({ row, hub }: { row: CmsFrameRow; hub: CmsShopHubFramesEnv | null }) {
  const layout = useCmsFrameLayoutMode();
  const hubOuter = useCmsHubFrameOuterClass();
  const p = row.payload;
  const id = typeof p.brand_id === "string" ? p.brand_id.trim() : "";
  const brand = id ? hub?.brands.find((b) => b.id === id) : undefined;
  const label = brand?.label ?? "Marque";
  const pseudo = pickPseudoFrame(`cms-brand-${row.id}`);
  const card = (
    <div
      className={cn(
        "flex aspect-[2.32] flex-col justify-end rounded-2xl bg-gradient-to-br p-4 text-zinc-900",
        pseudo.color,
      )}
    >
      <p className="text-[1.65rem] font-bold leading-tight text-zinc-900">{label}</p>
    </div>
  );

  if (hub && id && !hub.refsPreferShopNavigation) {
    return (
      <button type="button" className={cmsRefOuterClass(layout, hubOuter)} onClick={() => hub.onBrandFilter(id)}>
        {card}
      </button>
    );
  }

  return (
    <Link href="/shop" className={cn(cmsRefOuterClass(layout, hubOuter), "block")}>
      {card}
    </Link>
  );
}

/** Carte pièce hors hub : lien fiche + visuel CMS ou placeholder (même largeur que la boutique). */
function CmsShopItemRefStandalone({ row }: { row: CmsFrameRow }) {
  const layout = useCmsFrameLayoutMode();
  const hubOuter = useCmsHubFrameOuterClass();
  const p = row.payload;
  const id = typeof p.item_id === "string" ? p.item_id.trim() : "";
  if (!id) return null;
  const spotUrl = imageUrlFromPayload(p.item_spotlight_image);
  const title = p.title?.trim() || "";

  return (
    <Link href={`/items/${id}?from=cms`} className={cn(cmsRefOuterClass(layout, hubOuter), "block")}>
      <div className="w-full space-y-2">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-zinc-100 ring-1 ring-black/[0.06]">
          {spotUrl ? (
            <RemoteCoverThumb
              photoUrl={spotUrl}
              frameClassName="absolute inset-0 h-full w-full"
              photoPosition={p.item_spotlight_image?.position ?? null}
            />
          ) : (
            <div className="h-full w-full bg-zinc-200" aria-hidden />
          )}
        </div>
        {title ? <p className="px-0.5 text-left text-[14px] font-bold leading-snug text-zinc-900">{title}</p> : null}
      </div>
    </Link>
  );
}

function CmsShopLinkCardFrame({ row, hub }: { row: CmsFrameRow; hub: CmsShopHubFramesEnv | null }) {
  const layout = useCmsFrameLayoutMode();
  const hubOuter = useCmsHubFrameOuterClass();
  const payload = row.payload;
  if (hub?.renderShopLinkCard) return hub.renderShopLinkCard(row);
  return (
    <div className={layout === "stack" ? "w-full min-w-0" : hubOuter}>
      <ShopWideLinkCardBlock
        payload={payload}
        aspectClassName="aspect-[2.32]"
        wrapperClassName="block w-full rounded-2xl"
      />
    </div>
  );
}

/** Hero Obtenir plus : image plein cadre, voile sombre, texte centré (Playfair + Montserrat) + pastille CTA. */
function ProfilePlusHeroInner({ payload }: { payload: CmsFramePayload }) {
  const href = payload.target_url?.trim() || "/package";
  const bgUrl =
    payload.background?.kind === "image" ? imageUrlFromPayload(payload.background.image) : null;
  const kicker = payload.label?.trim() ?? "";
  const showSegnaXTitle = profilePlusHeroIsSegnaXKicker(kicker);
  const subtitle = payload.subtitle?.trim() ?? "";
  const ctaText = payload.cta_label?.trim() || "Découvrir";
  const hasTopBrandLine = showSegnaXTitle || Boolean(kicker);

  const [coverState, setCoverState] = useState<RemoteCoverLoadState>(() => (bgUrl ? "loading" : "ready"));
  useEffect(() => {
    setCoverState(bgUrl ? "loading" : "ready");
  }, [bgUrl]);

  const showStack = !bgUrl || coverState === "ready" || coverState === "failed";
  const fullCardShimmer = Boolean(bgUrl) && coverState === "loading";

  return (
    <Link href={href} className="block w-full min-w-0 max-w-none not-italic">
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-3xl shadow-sm ring-1 ring-black/[0.06]",
          CMS_PROFILE_PLUS_HERO_ASPECT_CLASS,
          !bgUrl ? backgroundLayerClass(payload) : "bg-zinc-900",
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
                photoCoverFill
                onLoadStateChange={setCoverState}
              />
            </div>
            {fullCardShimmer ? (
              <SegnaSkeletonBlock
                className="pointer-events-none absolute inset-0 z-[3]"
                rounded="rounded-3xl"
              />
            ) : null}
          </>
        ) : null}
        <div
          className={cn(
            "absolute inset-0 z-[2] flex flex-col items-center justify-center text-center text-white",
            !showStack && "invisible",
          )}
        >
          <div className="flex w-full min-w-0 flex-col items-center text-center">
            {showSegnaXTitle ? (
              <p
                className={cn(
                  segnaPlayfairDisplay.className,
                  "w-full whitespace-pre-line text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2.25rem]",
                )}
              >
                SegnaX
              </p>
            ) : kicker ? (
              <p
                className={cn(
                  segnaPlayfairDisplay.className,
                  "w-full whitespace-pre-line text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2.25rem]",
                )}
              >
                {kicker}
              </p>
            ) : null}
            {subtitle ? (
              <p
                className={cn(
                  segnaMontserrat.className,
                  "w-full whitespace-pre-line text-[0.95rem] font-semibold leading-snug text-white/95 sm:text-base",
                  hasTopBrandLine ? "mt-3 sm:mt-4" : "mt-2",
                )}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              segnaMontserrat.className,
              "segna-guidance-shimmer-target mt-6 inline-flex max-w-full items-center justify-center rounded-full bg-zinc-100 px-5 py-2.5 text-center text-[13px] font-bold leading-snug text-zinc-900 sm:px-6 sm:py-3 sm:text-sm",
            )}
          >
            {renderCmsStarBoldSegments(ctaText, "profile-plus-hero-cta")}
          </span>
        </div>
      </div>
    </Link>
  );
}

function CmsProfilePlusHeroFrame({ row }: { row: CmsFrameRow }) {
  return <ProfilePlusHeroInner payload={row.payload} />;
}

function renderCmsFrameContent(row: CmsFrameRow, hub: CmsShopHubFramesEnv | null) {
  const { frame_type, payload } = row;
  switch (frame_type) {
    case "offer_card":
      return <OfferCardInner payload={payload} />;
    case "category_capsule":
      return <CategoryCapsuleInner payload={payload} />;
    case "promo_ad":
      return <PromoAdInner payload={payload} />;
    case "editorial_card":
      return <EditorialCardInner payload={payload} />;
    case "shop_link_card":
      return <CmsShopLinkCardFrame row={row} hub={hub} />;
    case "shop_category_ref":
      return <CmsShopCategoryRefFrame row={row} hub={hub} />;
    case "shop_brand_ref":
      return <CmsShopBrandRefFrame row={row} hub={hub} />;
    case "shop_item_ref":
      if (hub?.renderShopItemRef) return hub.renderShopItemRef(row);
      return <CmsShopItemRefStandalone row={row} />;
    case "profile_plus_hero":
      return <CmsProfilePlusHeroFrame row={row} />;
    default:
      return null;
  }
}

export function CmsFrameItem({ row, layoutMode = "hub" }: { row: CmsFrameRow; layoutMode?: CmsFrameLayoutMode }) {
  const hub = useCmsShopHubFramesOptional();
  return (
    <CmsFrameLayoutModeProvider mode={layoutMode}>{renderCmsFrameContent(row, hub)}</CmsFrameLayoutModeProvider>
  );
}

/** Bloc vertical pour la fiche pièce stock Segna (Propriété Segna CMS). */
export function CmsSegnaStockPropertyFrames({ rows }: { rows: CmsFrameRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-3">
      {rows.map((row) => (
        <CmsFrameItem key={row.id} row={row} layoutMode="stack" />
      ))}
    </div>
  );
}

export function CmsHorizontalScrollRow({
  rows,
  className,
  hubFrameOuterClass,
  layout = "rail",
  promoVisualOnly = false,
}: {
  rows: CmsFrameRow[];
  className?: string;
  /** Si défini, remplace le gabarit largeur des cartes hub (`shop_link_card`, refs, promos…). */
  hubFrameOuterClass?: string;
  /** `rail` : défilement horizontal. `stack` : cartes empilées sans scroll. */
  layout?: "rail" | "stack";
  /** `promo_ad` hub / stack : image seule (section Prêts Échange abonnés). */
  promoVisualOnly?: boolean;
}) {
  if (rows.length === 0) return null;
  const single = rows.length === 1;
  const rowList = rows.map((row) => <CmsFrameItem key={row.id} row={row} />);
  const inner =
    layout === "stack" ? (
      <div className={cn("mt-3 flex w-full min-w-0 flex-col gap-3", className)}>{rowList}</div>
    ) : (
      <div
        className={cn(
          "-mx-5 mt-3 flex items-start gap-3 overflow-x-auto overflow-y-hidden pb-1 touch-pan-x px-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          single && "justify-center",
          className,
        )}
      >
        {rowList}
      </div>
    );
  let wrapped: ReactNode = inner;
  if (hubFrameOuterClass != null) {
    wrapped = (
      <CmsHubFrameOuterClassContext.Provider value={hubFrameOuterClass}>{wrapped}</CmsHubFrameOuterClassContext.Provider>
    );
  }
  if (promoVisualOnly) {
    wrapped = <CmsPromoVisualOnlyContext.Provider value>{wrapped}</CmsPromoVisualOnlyContext.Provider>;
  }
  return wrapped;
}
