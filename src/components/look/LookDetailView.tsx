"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InspirationMediaViewer } from "@/components/community/InspirationMediaViewer";
import type { ItemInfoCardData } from "@/components/item/ItemInfoCard";
import { ItemPhotoStickyHeader } from "@/components/item/ItemPhotoOverlayActions";
import { ItemSizeConditionCard } from "@/components/item/ItemSizeConditionCard";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { SEGNA_DIALOG_CARD_CLASS, segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { LookMediaLightbox } from "@/components/look/LookMediaLightbox";
import { LookRelatedInspisSection } from "@/components/look/LookRelatedInspisSection";
import { deleteCommunityInspiration } from "@/lib/community/community-actions";
import { inspirationMemberTag } from "@/lib/community/inspiration-member-tag";
import { isSafeInAppReturnPath } from "@/lib/community/create-inspiration-href";
import type { InspirationDetail } from "@/lib/community/types";
import { formatEuroPerCredit } from "@/lib/billing/fetch-borrow-checkout-options";
import { computeItemWeeklyRentalEuroCents } from "@/lib/billing/guest-rental-pricing";
import type { ItemStyleLookSummary } from "@/lib/items/fetch-item-style-looks";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createSignedUrlForStoragePath,
  createSignedUrlsForStoragePaths,
  normalizeStorageObjectPath,
} from "@/lib/supabase/storage-resolve-signed-url";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const PIECE_THUMB_SIZE_PX = 88;
const SELECTED_PIECE_IMAGE_WIDTH_PX = 132;

type LookDetailViewProps = {
  detail: InspirationDetail;
  companionItems: ShopCatalogItem[];
  initialCoverUrlById?: Record<string, string>;
  relatedLooks?: ItemStyleLookSummary[];
};

function shopCatalogItemToInfoCard(item: ShopCatalogItem): ItemInfoCardData {
  return {
    pricePoints: item.price_points,
    size: item.size_label?.trim() || "—",
    materials: item.materials_label?.trim() || "—",
    color: item.color_label?.trim() || "—",
    brand: item.brand_label?.trim() || "—",
    condition: item.condition_label?.trim() || "—",
    categoryLabel: item.category_label,
  };
}

export function LookDetailView({
  detail,
  companionItems,
  initialCoverUrlById = {},
  relatedLooks = [],
}: LookDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const backHref = useMemo(() => {
    const from = searchParams.get("from");
    return from && isSafeInAppReturnPath(from) ? from.trim() : null;
  }, [searchParams]);
  const handleBack = useCallback(() => {
    if (backHref) {
      router.push(backHref);
      return;
    }
    router.back();
  }, [backHref, router]);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const gallerySentinelRef = useRef<HTMLDivElement | null>(null);
  const pieceScrollRef = useRef<HTMLDivElement | null>(null);
  const [headerSolid, setHeaderSolid] = useState(false);
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>(initialCoverUrlById);
  const [resolvedMediaUrls, setResolvedMediaUrls] = useState<string[]>(detail.media_urls ?? []);
  const [resolvedPosterUrl, setResolvedPosterUrl] = useState<string | null>(detail.poster_url ?? null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled) setViewerUserId(user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const isOwnLook =
    detail.source === "member" &&
    typeof detail.author_user_id === "string" &&
    viewerUserId !== null &&
    detail.author_user_id === viewerUserId;

  const headerActionIconClass = headerSolid ? "text-zinc-900" : "text-white";

  const handleConfirmDelete = useCallback(async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const ok = await deleteCommunityInspiration(supabase, detail.id);
      if (!ok) {
        setDeleteError("Suppression impossible. Réessaie dans un instant.");
        return;
      }
      if (backHref) {
        router.push(backHref);
        return;
      }
      if (viewerUserId) {
        router.push(`/membre/${viewerUserId}`);
        return;
      }
      router.push("/home");
    } finally {
      setIsDeleting(false);
    }
  }, [backHref, detail.id, router, supabase, viewerUserId]);

  const ownerDeleteAction = isOwnLook ? (
    <button
      type="button"
      onClick={() => {
        setDeleteError(null);
        setDeleteModalOpen(true);
      }}
      aria-label="Supprimer le look"
      className={cn("p-1", headerActionIconClass)}
    >
      <Trash2 className="h-5 w-5" strokeWidth={2.2} aria-hidden />
    </button>
  ) : null;

  const handleMediaClick = useCallback((index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  useEffect(() => {
    setResolvedMediaUrls(detail.media_urls ?? []);
    setResolvedPosterUrl(detail.poster_url ?? null);
  }, [detail.id, detail.media_urls, detail.poster_url]);

  useEffect(() => {
    if ((detail.media_urls ?? []).length > 0) return;
    if (detail.media_paths.length === 0) return;

    let cancelled = false;
    (async () => {
      const bucket = detail.media_bucket || "bucket_cms_app";
      const signedByPath = await createSignedUrlsForStoragePaths(
        supabase,
        detail.media_paths.map(normalizeStorageObjectPath).filter(Boolean),
        60 * 60 * 24,
        { explicitBucket: bucket },
      );
      const urls = detail.media_paths
        .map((path) => signedByPath.get(normalizeStorageObjectPath(path)) ?? null)
        .filter((url): url is string => Boolean(url));
      if (cancelled || urls.length === 0) return;

      setResolvedMediaUrls(urls);

      if (detail.video_poster_path) {
        const poster = await createSignedUrlForStoragePath(
          supabase,
          normalizeStorageObjectPath(detail.video_poster_path),
          60 * 60 * 24,
          { explicitBucket: bucket },
        );
        if (!cancelled && poster) setResolvedPosterUrl(poster);
      } else if (detail.media_type === "video" && urls[0]) {
        setResolvedPosterUrl(urls[0]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detail, supabase]);

  const linkedPieces = useMemo(() => {
    const byId = new Map(companionItems.map((item) => [item.id, item]));
    return detail.companions
      .map((companion) => {
        const item = byId.get(companion.item_id);
        if (!item) return null;
        return { companion, item };
      })
      .filter((row): row is { companion: (typeof detail.companions)[number]; item: ShopCatalogItem } => row !== null);
  }, [companionItems, detail.companions]);

  const [selectedItemId, setSelectedItemId] = useState<string>(() => linkedPieces[0]?.item.id ?? "");

  useEffect(() => {
    if (linkedPieces.length === 0) {
      setSelectedItemId("");
      return;
    }
    if (!linkedPieces.some((row) => row.item.id === selectedItemId)) {
      setSelectedItemId(linkedPieces[0]!.item.id);
    }
  }, [linkedPieces, selectedItemId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pathByItemId = new Map<string, string>();
      for (const { item } of linkedPieces) {
        if (coverUrlById[item.id]) continue;
        const path = getFirstPhotoStoragePath(item.photos);
        if (!path) continue;
        pathByItemId.set(item.id, path);
      }
      if (pathByItemId.size === 0) return;
      const signedByPath = await createSignedUrlsForStoragePaths(supabase, [...pathByItemId.values()], 60 * 60 * 24);
      if (cancelled) return;
      const updates: Record<string, string> = {};
      for (const [id, path] of pathByItemId) {
        const url = signedByPath.get(path);
        if (url) updates[id] = url;
      }
      if (Object.keys(updates).length > 0) {
        setCoverUrlById((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coverUrlById, linkedPieces, supabase]);

  useEffect(() => {
    const sentinel = gallerySentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeaderSolid(!entry.isIntersecting);
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [detail.media_type, resolvedMediaUrls.length]);

  const selectedItem = linkedPieces.find((row) => row.item.id === selectedItemId)?.item ?? linkedPieces[0]?.item ?? null;
  const selectedInfoCard = selectedItem ? shopCatalogItemToInfoCard(selectedItem) : null;
  const mediaUrls = resolvedMediaUrls;
  const pieceCountLabel = `${linkedPieces.length} article${linkedPieces.length > 1 ? "s" : ""}`;
  const brandLabel = selectedInfoCard?.brand?.trim();
  const showBrand = Boolean(brandLabel && brandLabel !== "-");
  const memberTag = inspirationMemberTag(detail.author_display_name, detail.author_instagram_username);
  const selectedCoverUrl = selectedItem ? coverUrlById[selectedItem.id] : undefined;
  const selectedPriceLabel =
    selectedItem?.price_points != null && !Number.isNaN(selectedItem.price_points)
      ? formatEuroPerCredit(computeItemWeeklyRentalEuroCents(selectedItem.price_points))
      : "—";

  return (
    <div className="relative z-0 w-full pb-28">
          <div className="pb-2">
            <ItemPhotoStickyHeader
              onBack={handleBack}
              title={selectedItem?.title ?? detail.title}
              iconTone="light"
              solid={headerSolid}
              showCartNav={!isOwnLook}
              ownerMenu={ownerDeleteAction}
            />

            <div className="space-y-[4.5px] bg-zinc-100">
              <div className="bg-white">
                <div className="relative w-full min-w-full bg-white">
                  <InspirationMediaViewer
                    mediaType={detail.media_type}
                    mediaUrls={mediaUrls}
                    posterUrl={resolvedPosterUrl}
                    coverAspect={detail.cover_aspect}
                    coverTransform={detail.cover_transform}
                    className="rounded-none"
                    variant="detail"
                    priority
                    onMediaClick={handleMediaClick}
                  />

                  {linkedPieces.length > 0 ? (
                    <div className="flex items-center justify-between gap-3 bg-white px-6 py-3">
                      {detail.author_user_id ? (
                        <Link
                          href={`/membre/${detail.author_user_id}`}
                          className={cn(
                            montserrat.className,
                            "text-[13px] font-bold uppercase tracking-wide text-zinc-900 underline-offset-2 hover:underline",
                          )}
                        >
                          {memberTag}
                        </Link>
                      ) : (
                        <p
                          className={cn(
                            montserrat.className,
                            "text-[13px] font-bold uppercase tracking-wide text-zinc-900",
                          )}
                        >
                          {memberTag}
                        </p>
                      )}
                      <p className={cn(montserrat.className, "text-[12px] font-semibold text-zinc-500")}>
                        {pieceCountLabel}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div ref={gallerySentinelRef} className="h-0 w-full" aria-hidden />

                {linkedPieces.length > 0 ? (
                  <div className="bg-white pb-3">
                    <div
                      ref={pieceScrollRef}
                      className="flex gap-3 overflow-x-auto px-6 pb-2 pt-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      {linkedPieces.map(({ item }) => {
                        const selected = item.id === selectedItemId;
                        const coverUrl = coverUrlById[item.id];
                        return (
                          <button
                            key={item.id}
                            type="button"
                            aria-label={`Voir ${item.title}`}
                            aria-pressed={selected}
                            onClick={() => setSelectedItemId(item.id)}
                            className={cn(
                              "relative shrink-0 box-border overflow-hidden rounded-lg bg-zinc-100 transition",
                              selected
                                ? "border-2 border-zinc-900"
                                : "border-2 border-transparent opacity-85 hover:opacity-100",
                            )}
                            style={{ width: PIECE_THUMB_SIZE_PX, height: PIECE_THUMB_SIZE_PX }}
                          >
                            {coverUrl ? (
                              <RemoteCoverThumb photoUrl={coverUrl} frameClassName="h-full w-full" photoCoverFill />
                            ) : (
                              <div className="h-full w-full bg-zinc-200" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              {selectedItem && selectedInfoCard ? (
                <div className="bg-white px-6 py-4">
                  <div className="flex items-start gap-3">
                    <Link
                      href={`/items/${selectedItem.id}?from=look`}
                      className="relative block aspect-[3/4] shrink-0 overflow-hidden rounded-lg bg-zinc-100 ring-2 ring-inset ring-zinc-200 transition active:scale-[0.98]"
                      style={{ width: SELECTED_PIECE_IMAGE_WIDTH_PX }}
                      aria-label={`Voir l'article ${selectedItem.title}`}
                    >
                      {selectedCoverUrl ? (
                        <RemoteCoverThumb
                          photoUrl={selectedCoverUrl}
                          frameClassName="h-full w-full"
                          photoCoverFill
                        />
                      ) : (
                        <div className="h-full w-full bg-zinc-200" />
                      )}
                    </Link>

                    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                      <div className="space-y-1">
                        <h2
                          className={cn(
                            montserrat.className,
                            "line-clamp-3 text-[12px] font-bold uppercase leading-snug tracking-wide text-zinc-900",
                          )}
                        >
                          {selectedItem.title}
                        </h2>
                        {showBrand ? (
                          <p className={cn(montserrat.className, "line-clamp-2 text-[12px] font-medium text-zinc-500")}>
                            {brandLabel}
                          </p>
                        ) : null}
                        <p className={cn(montserrat.className, "text-[15px] font-bold tabular-nums text-zinc-900")}>
                          {selectedPriceLabel}
                        </p>
                      </div>

                      <ItemSizeConditionCard
                        variant="compact"
                        className="rounded-lg px-2 py-1.5"
                        data={{
                          labelSize: selectedInfoCard.size,
                          condition: selectedInfoCard.condition,
                          recommendedSize: selectedInfoCard.recommendedSize ?? "—",
                          sizeDescription: selectedInfoCard.sizeDescription,
                          categoryLabel: selectedInfoCard.categoryLabel,
                        }}
                      />

                      <Link
                        href={`/items/${selectedItem.id}?from=look`}
                        className={cn(
                          montserrat.className,
                          "mt-0.5 flex h-11 w-full items-center justify-center rounded-xl bg-zinc-950 px-3 text-[12px] font-bold uppercase tracking-[0.06em] text-white transition active:scale-[0.99]",
                        )}
                      >
                        Voir l&apos;article
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}

              {relatedLooks.length > 0 ? (
                <div className="bg-white">
                  <LookRelatedInspisSection looks={relatedLooks} />
                </div>
              ) : null}
            </div>
          </div>

      <LookMediaLightbox
        open={lightboxOpen}
        onClose={handleCloseLightbox}
        mediaUrls={mediaUrls}
        initialIndex={lightboxIndex}
      />

      {deleteModalOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div
            className={cn(SEGNA_DIALOG_CARD_CLASS, "max-w-[430px]")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="look-delete-title"
          >
            <h2 id="look-delete-title" className={segnaDialogTitleClass()}>
              Supprimer ce look ?
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              Il sera retiré de ton profil et ne sera plus visible dans le feed.
            </p>
            {deleteError ? <p className="mt-2 text-sm text-[#E44D3E]">{deleteError}</p> : null}
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalOpen(false);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="h-11 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-900 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
                className="h-11 rounded-xl bg-[#E44D3E] text-sm font-semibold text-white disabled:opacity-60"
              >
                {isDeleting ? "Suppression…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
