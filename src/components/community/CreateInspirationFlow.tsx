"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, ImageIcon, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type RefObject, type TouchEvent } from "react";

import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { RemoteCoverThumb } from "@/components/ui/RemoteCoverThumb";
import { AppPageLoading } from "@/components/ui/AppPageLoading";
import { GalleryDots } from "@/components/ui/GalleryDots";
import { InspirationCoverAspectMenu } from "@/components/community/InspirationCoverAspectMenu";
import { publishCommunityInspiration } from "@/lib/community/community-actions";
import {
  createInspirationHref,
  lookDetailHref,
  resolveCreateInspirationReturnTo,
} from "@/lib/community/create-inspiration-href";
import { fetchMemberWornCatalogItems } from "@/lib/community/fetch-member-worn-catalog-items";
import {
  type InspirationCoverAspect,
  type InspirationCoverTransform,
  inspirationCoverAspectClass,
  inspirationCoverStageRatio,
  parseInspirationCoverAspect,
} from "@/lib/community/inspiration-cover-aspect";
import { getFirstPhotoStoragePath } from "@/lib/items/parse-item-photos";
import {
  dataUrlToFile,
  ITEM_PHOTO_PREPARE_FAILED_MESSAGE,
  ITEM_PHOTO_RETURN_LOST_MESSAGE,
  ITEM_PHOTO_SLOT_INVALID_MESSAGE,
  ITEM_PHOTO_STORAGE_QUOTA_MESSAGE,
  preparePhotoModifyImage,
  readPhotoModifyDraft,
  registerPhotoModifyRuntimeFile,
  removePhotoModifyDraft,
  savePhotoModifyDraft,
  toPersistableDataUrl,
} from "@/lib/onboarding/photoModifyStore";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";
import { segnaPlayfairDisplay, SEGNA_SECTION_TITLE_CLASSNAME } from "@/lib/ui/segna-playfair-display";
import { cn } from "@/lib/utils/cn";

const BUCKET = "bucket_community";
const MAX_MEDIA_ITEMS = 6;
const LINKED_PIECE_THUMB_SIZE_PX = 88;
const THUMB_DRAG_START_THRESHOLD_PX = 10;
const MAX_LINKED_ITEMS = 12;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MEDIA_ITEMS_STORAGE_KEY = "segna:community-create:media-items";
const LINKED_ITEMS_STORAGE_KEY = "segna:community-create:linked-items";
const COVER_ASPECT_STORAGE_KEY = "segna:community-create:cover-aspect";

function isMediaSlot(value: unknown): value is MediaSlot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const offset = row.offset;
  const kind = row.kind === "video" ? "video" : "photo";
  return (
    (kind === "photo" || kind === "video") &&
    typeof row.dataUrl === "string" &&
    typeof row.fileName === "string" &&
    typeof row.mimeType === "string" &&
    typeof row.imageRatio === "number" &&
    typeof row.zoom === "number" &&
    offset != null &&
    typeof offset === "object" &&
    typeof (offset as { x?: unknown }).x === "number" &&
    typeof (offset as { y?: unknown }).y === "number"
  );
}

function normalizeMediaSlot(value: unknown): MediaSlot | null {
  if (!isMediaSlot(value)) return null;
  const row = value as MediaSlot;
  return {
    ...row,
    kind: row.kind === "video" ? "video" : "photo",
  };
}

function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "mov" || ext === "mp4" || ext === "m4v";
}

function revokeMediaPreviewUrl(slot: MediaSlot) {
  if (slot.kind === "video" && slot.dataUrl.startsWith("blob:")) {
    URL.revokeObjectURL(slot.dataUrl);
  }
}

function insertMediaSlot(prev: MediaSlot[], slotIndex: number, nextItem: MediaSlot): MediaSlot[] {
  if (slotIndex < 0 || slotIndex > prev.length || slotIndex >= MAX_MEDIA_ITEMS) return prev;
  const next = [...prev];
  const previous = next[slotIndex];
  if (previous) revokeMediaPreviewUrl(previous);
  if (slotIndex === next.length) next.push(nextItem);
  else next[slotIndex] = nextItem;
  return next;
}

function isSessionPersistablePhotoDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:image/");
}

function loadPersistedMediaItems(): MediaSlot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(MEDIA_ITEMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items = parsed.map(normalizeMediaSlot).filter((slot): slot is MediaSlot => slot !== null).slice(0, MAX_MEDIA_ITEMS);
    const valid = items.filter((slot) => slot.kind === "video" || isSessionPersistablePhotoDataUrl(slot.dataUrl));
    if (valid.length !== items.length) {
      if (valid.length > 0) persistMediaItems(valid);
      else clearPersistedMediaItems();
    }
    return valid;
  } catch {
    return [];
  }
}

function persistMediaItems(items: MediaSlot[]) {
  if (typeof window === "undefined") return;
  const photoItems = items.filter(
    (slot) => slot.kind !== "video" && isSessionPersistablePhotoDataUrl(slot.dataUrl),
  );
  if (photoItems.length === 0) return;
  try {
    window.sessionStorage.setItem(MEDIA_ITEMS_STORAGE_KEY, JSON.stringify(photoItems));
  } catch {
    // quota — les brouillons photo restent dans photoModifyStore
  }
}

function clearPersistedMediaItems() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(MEDIA_ITEMS_STORAGE_KEY);
}

function isSelectedItem(value: unknown): value is SelectedItem {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.item_id === "string" && typeof row.role_label === "string";
}

function loadPersistedLinkedItems(): SelectedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(LINKED_ITEMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSelectedItem).slice(0, MAX_LINKED_ITEMS);
  } catch {
    return [];
  }
}

function persistLinkedItems(items: SelectedItem[]) {
  if (typeof window === "undefined") return;
  try {
    if (items.length === 0) {
      window.sessionStorage.removeItem(LINKED_ITEMS_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(LINKED_ITEMS_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota
  }
}

function clearPersistedLinkedItems() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(LINKED_ITEMS_STORAGE_KEY);
}

function loadPersistedCoverAspect(): InspirationCoverAspect {
  if (typeof window === "undefined") return "portrait";
  try {
    const raw = window.sessionStorage.getItem(COVER_ASPECT_STORAGE_KEY);
    if (!raw) return "portrait";
    return parseInspirationCoverAspect(raw);
  } catch {
    return "portrait";
  }
}

function persistCoverAspect(aspect: InspirationCoverAspect) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(COVER_ASPECT_STORAGE_KEY, aspect);
  } catch {
    // quota
  }
}

function clearPersistedCoverAspect() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(COVER_ASPECT_STORAGE_KEY);
}

type MediaSlot = {
  kind: "photo" | "video";
  dataUrl: string;
  fileName: string;
  mimeType: string;
  imageRatio: number;
  offset: { x: number; y: number };
  zoom: number;
  file?: File;
};

type SelectedItem = { item_id: string; role_label: string };

const getImageRatio = (dataUrl: string) =>
  new Promise<number>((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (image.width > 0 && image.height > 0) {
        resolve(image.width / image.height);
        return;
      }
      resolve(1);
    };
    image.onerror = () => resolve(1);
    image.src = dataUrl;
  });

function slotCoverStyle(slot: MediaSlot, stageRatio: number) {
  return {
    backgroundSize: `${Math.max(100, 100 * (slot.imageRatio / stageRatio)) * slot.zoom}%`,
    backgroundPosition: `calc(50% + ${slot.offset.x}%) calc(50% + ${slot.offset.y}%)`,
    backgroundRepeat: "no-repeat" as const,
  };
}

function useCarouselIndex(scrollRef: RefObject<HTMLDivElement | null>, slideCount: number) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || slideCount <= 0) {
      setIndex(0);
      return;
    }

    const syncIndex = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const next = Math.max(0, Math.min(slideCount - 1, Math.round(el.scrollLeft / width)));
      setIndex(next);
    };

    syncIndex();
    el.addEventListener("scroll", syncIndex, { passive: true });
    return () => el.removeEventListener("scroll", syncIndex);
  }, [scrollRef, slideCount]);

  return index;
}

function CreateAmbientVideo({
  src,
  active = true,
  className,
}: {
  src: string;
  active?: boolean;
  className?: string;
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
    />
  );
}

function EmptyMediaAddFrame({
  className,
  style,
  onClick,
  label,
  size = "default",
}: {
  className?: string;
  style?: CSSProperties;
  onClick: () => void;
  label: string;
  size?: "default" | "compact";
}) {
  const isCompact = size === "compact";
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={cn(
        "flex items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 transition hover:border-zinc-400 hover:bg-zinc-100",
        className,
      )}
      aria-label={label}
    >
      <div className="relative inline-flex items-center justify-center">
        <ImageIcon size={isCompact ? 18 : 24} className="text-zinc-400" />
        <span
          className={cn(
            "absolute inline-flex items-center justify-center rounded-full bg-zinc-900 text-white",
            isCompact ? "-bottom-1 -right-1 h-5 w-5" : "-bottom-1.5 -right-1.5 h-6 w-6",
          )}
        >
          <Plus size={isCompact ? 10 : 12} strokeWidth={3} />
        </span>
      </div>
    </button>
  );
}

function itemMatchesSearch(item: ShopCatalogItem, query: string): boolean {
  const hay = `${item.title} ${item.brand_label ?? ""} ${item.category_label ?? ""}`.toLowerCase();
  return hay.includes(query);
}

function reorderMediaItems(items: MediaSlot[], fromIndex: number, toIndex: number): MediaSlot[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function CreateInspirationFlow() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = resolveCreateInspirationReturnTo(searchParams.get("returnTo"));
  const createReturnPath = useMemo(() => createInspirationHref(returnTo), [returnTo]);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const heroScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingSlotRef = useRef<number | null>(null);
  const handledPhotoModifyIdsRef = useRef<Set<string>>(new Set());
  const touchStartRef = useRef<{ x: number; y: number; index: number } | null>(null);
  const suppressNextThumbClickRef = useRef(false);

  const [mediaItems, setMediaItems] = useState<MediaSlot[]>([]);
  const [draggingThumbIndex, setDraggingThumbIndex] = useState<number | null>(null);
  const [dragOverThumbIndex, setDragOverThumbIndex] = useState<number | null>(null);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>(() => loadPersistedLinkedItems());
  const [wornItems, setWornItems] = useState<ShopCatalogItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<ShopCatalogItem[]>([]);
  const [coverUrlById, setCoverUrlById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverAspect, setCoverAspect] = useState<InspirationCoverAspect>(() => loadPersistedCoverAspect());
  const coverAspectClass = useMemo(() => inspirationCoverAspectClass(coverAspect), [coverAspect]);
  const coverStageRatio = useMemo(() => inspirationCoverStageRatio(coverAspect), [coverAspect]);
  const mediaThumbWidthPx = useMemo(() => {
    if (coverAspect === "landscape") {
      return Math.round(LINKED_PIECE_THUMB_SIZE_PX * coverStageRatio);
    }
    return LINKED_PIECE_THUMB_SIZE_PX;
  }, [coverAspect, coverStageRatio]);
  const mediaThumbHeightPx = useMemo(
    () => Math.round(mediaThumbWidthPx / coverStageRatio),
    [mediaThumbWidthPx, coverStageRatio],
  );

  useEffect(() => {
    const stored = loadPersistedMediaItems();
    if (stored.length > 0) setMediaItems(stored);
    const storedLinked = loadPersistedLinkedItems();
    if (storedLinked.length > 0) setSelectedItems(storedLinked);
    setCoverAspect(loadPersistedCoverAspect());
  }, [searchParams]);

  useEffect(() => {
    persistCoverAspect(coverAspect);
  }, [coverAspect]);

  useEffect(() => {
    if (mediaItems.length === 0) return;
    let cancelled = false;
    void (async () => {
      const needsNormalize = mediaItems.some(
        (slot) => slot.kind === "photo" && !isSessionPersistablePhotoDataUrl(slot.dataUrl),
      );
      const normalized = needsNormalize
        ? await Promise.all(
            mediaItems.map(async (slot) => {
              if (slot.kind !== "photo" || isSessionPersistablePhotoDataUrl(slot.dataUrl)) return slot;
              return { ...slot, dataUrl: await toPersistableDataUrl(slot.dataUrl) };
            }),
          )
        : mediaItems;
      if (cancelled) return;
      if (needsNormalize) {
        setMediaItems(normalized);
        persistMediaItems(normalized);
      } else {
        persistMediaItems(mediaItems);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaItems]);

  useEffect(() => {
    persistLinkedItems(selectedItems);
  }, [selectedItems]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const [worn, catalogRes] = await Promise.all([
        fetchMemberWornCatalogItems(supabase, user.id),
        supabase.rpc("get_shop_catalog_items", { p_limit: 120 }),
      ]);
      if (cancelled) return;

      setWornItems(worn);

      let catalog: ShopCatalogItem[] = [];
      if (!catalogRes.error) {
        const root =
          catalogRes.data && typeof catalogRes.data === "object" && !Array.isArray(catalogRes.data)
            ? (catalogRes.data as { items?: unknown })
            : {};
        catalog = Array.isArray(root.items) ? (root.items as ShopCatalogItem[]) : [];
      }
      setCatalogItems(catalog);

      const allItems = [...worn, ...catalog.filter((item) => !worn.some((w) => w.id === item.id))];
      const paths = allItems.map((item) => getFirstPhotoStoragePath(item.photos)).filter(Boolean) as string[];
      const signed = await createSignedUrlsForStoragePaths(supabase, paths, 60 * 60);
      if (cancelled) return;

      const next: Record<string, string> = {};
      allItems.forEach((item) => {
        const path = getFirstPhotoStoragePath(item.photos);
        if (path && signed.get(path)) next[item.id] = signed.get(path)!;
      });
      setCoverUrlById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const heroIndex = useCarouselIndex(heroScrollRef, mediaItems.length);

  const scrollHeroToIndex = useCallback((index: number) => {
    const el = heroScrollRef.current;
    if (!el) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    el.scrollTo({ left: width * index, behavior: "smooth" });
  }, []);

  const moveMediaItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      setMediaItems((prev) => {
        const next = reorderMediaItems(prev, fromIndex, toIndex);
        persistMediaItems(next);
        return next;
      });
      requestAnimationFrame(() => scrollHeroToIndex(toIndex));
    },
    [scrollHeroToIndex],
  );

  const resetThumbDragState = useCallback(() => {
    setDraggingThumbIndex(null);
    setDragOverThumbIndex(null);
  }, []);

  const onDropThumb = useCallback(
    (dropIndex: number) => {
      if (draggingThumbIndex !== null) {
        moveMediaItem(draggingThumbIndex, dropIndex);
        suppressNextThumbClickRef.current = true;
      }
      resetThumbDragState();
    },
    [draggingThumbIndex, moveMediaItem, resetThumbDragState],
  );

  const onTouchMoveThumb = useCallback(
    (event: TouchEvent<HTMLButtonElement>) => {
      const touch = event.touches[0];
      if (!touch) return;

      if (draggingThumbIndex === null && touchStartRef.current) {
        const deltaX = touch.clientX - touchStartRef.current.x;
        const deltaY = touch.clientY - touchStartRef.current.y;
        if (
          Math.abs(deltaX) >= THUMB_DRAG_START_THRESHOLD_PX &&
          Math.abs(deltaX) >= Math.abs(deltaY)
        ) {
          setDraggingThumbIndex(touchStartRef.current.index);
          setDragOverThumbIndex(touchStartRef.current.index);
          suppressNextThumbClickRef.current = true;
          event.preventDefault();
        }
        return;
      }

      if (draggingThumbIndex === null) return;
      event.preventDefault();
      const hovered = document.elementFromPoint(touch.clientX, touch.clientY)?.closest("[data-thumb-index]");
      const rawIndex = hovered?.getAttribute("data-thumb-index");
      const nextIndex = rawIndex ? Number(rawIndex) : null;
      setDragOverThumbIndex(Number.isInteger(nextIndex) ? (nextIndex as number) : null);
    },
    [draggingThumbIndex],
  );

  const onTouchEndThumb = useCallback(() => {
    touchStartRef.current = null;

    if (draggingThumbIndex !== null && dragOverThumbIndex !== null) {
      moveMediaItem(draggingThumbIndex, dragOverThumbIndex);
      suppressNextThumbClickRef.current = true;
    }
    if (draggingThumbIndex !== null) {
      suppressNextThumbClickRef.current = true;
    }
    resetThumbDragState();
  }, [dragOverThumbIndex, draggingThumbIndex, moveMediaItem, resetThumbDragState]);

  const wornIdSet = useMemo(() => new Set(wornItems.map((item) => item.id)), [wornItems]);
  const searchQuery = search.trim().toLowerCase();
  const isSearching = searchQuery.length > 0;

  const filteredWornItems = useMemo(() => {
    if (!isSearching) return wornItems;
    return wornItems.filter((item) => itemMatchesSearch(item, searchQuery));
  }, [isSearching, searchQuery, wornItems]);

  const filteredOtherItems = useMemo(() => {
    if (!isSearching) return [];
    return catalogItems
      .filter((item) => !wornIdSet.has(item.id))
      .filter((item) => itemMatchesSearch(item, searchQuery))
      .slice(0, 40);
  }, [catalogItems, isSearching, searchQuery, wornIdSet]);

  const catalogItemById = useMemo(() => {
    const map = new Map<string, ShopCatalogItem>();
    [...wornItems, ...catalogItems].forEach((item) => map.set(item.id, item));
    return map;
  }, [catalogItems, wornItems]);

  const selectedCatalogItems = useMemo(
    () =>
      selectedItems
        .map((row) => catalogItemById.get(row.item_id) ?? null)
        .filter((item): item is ShopCatalogItem => item !== null),
    [catalogItemById, selectedItems],
  );

  const clearPhotoModifyIdFromUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("photoModifyId");
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const modifiedId = searchParams.get("photoModifyId");
    if (!modifiedId) return;
    if (handledPhotoModifyIdsRef.current.has(modifiedId)) return;

    void (async () => {
      const draft = readPhotoModifyDraft(modifiedId);
      if (!draft || draft.source !== "item" || draft.returnPath !== createReturnPath) {
        setError(ITEM_PHOTO_RETURN_LOST_MESSAGE);
        clearPhotoModifyIdFromUrl();
        return;
      }

      if (draft.status === "cancelled") {
        handledPhotoModifyIdsRef.current.add(modifiedId);
        removePhotoModifyDraft(modifiedId);
        clearPhotoModifyIdFromUrl();
        return;
      }

      if (draft.status !== "confirmed") return;

      const slotFromDraft =
        typeof draft.slot === "number" && draft.slot >= 0 && draft.slot < MAX_MEDIA_ITEMS ? draft.slot : null;
      const resolvedSlot = slotFromDraft ?? pendingSlotRef.current;
      if (resolvedSlot == null || resolvedSlot < 0 || resolvedSlot >= MAX_MEDIA_ITEMS) {
        setError(ITEM_PHOTO_SLOT_INVALID_MESSAGE);
        clearPhotoModifyIdFromUrl();
        return;
      }

      handledPhotoModifyIdsRef.current.add(modifiedId);

      try {
        const nextAspect = parseInspirationCoverAspect(draft.aspect);
        setCoverAspect(nextAspect);
        persistCoverAspect(nextAspect);
        const persistableDataUrl = await toPersistableDataUrl(draft.dataUrl);
        const imageRatio = await getImageRatio(persistableDataUrl);
        const nextItem: MediaSlot = {
          kind: "photo",
          dataUrl: persistableDataUrl,
          fileName: draft.fileName,
          mimeType: draft.mimeType,
          imageRatio,
          offset: { x: draft.offset.x, y: draft.offset.y },
          zoom: draft.zoom,
        };
        setMediaItems((prev) => {
          const stored = loadPersistedMediaItems();
          const base = prev.length > 0 ? prev : stored;
          const next = [...base];
          if (resolvedSlot === next.length) {
            next.push(nextItem);
          } else if (resolvedSlot < next.length) {
            next[resolvedSlot] = nextItem;
          } else {
            return base.length > 0 ? base : stored;
          }
          persistMediaItems(next);
          return next;
        });
        setError(null);
        removePhotoModifyDraft(modifiedId);
        pendingSlotRef.current = null;
        clearPhotoModifyIdFromUrl();
      } catch {
        setError(ITEM_PHOTO_PREPARE_FAILED_MESSAGE);
        clearPhotoModifyIdFromUrl();
      }
    })();
  }, [clearPhotoModifyIdFromUrl, createReturnPath, searchParams]);

  const openPickerForNew = () => {
    if (mediaItems.length >= MAX_MEDIA_ITEMS) return;
    pendingSlotRef.current = mediaItems.length;
    persistCoverAspect(coverAspect);
    persistMediaItems(mediaItems);
    persistLinkedItems(selectedItems);
    fileInputRef.current?.click();
  };

  const openModifyForSlot = (index: number, slot: MediaSlot) => {
    if (slot.kind === "video") return;
    persistCoverAspect(coverAspect);
    persistMediaItems(mediaItems);
    persistLinkedItems(selectedItems);
    const draftId = crypto.randomUUID();
    try {
      savePhotoModifyDraft({
        id: draftId,
        source: "item",
        returnPath: createReturnPath,
        dataUrl: slot.dataUrl,
        fileName: slot.fileName,
        mimeType: slot.mimeType,
        itemId: "community-create",
        slot: index,
        aspect: coverAspect,
        offset: { x: slot.offset.x, y: slot.offset.y },
        zoom: slot.zoom,
        status: "pending",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : ITEM_PHOTO_STORAGE_QUOTA_MESSAGE);
      return;
    }
    router.push(`/modify?id=${encodeURIComponent(draftId)}`);
  };

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (isVideoFile(file)) {
      if (file.size > MAX_VIDEO_BYTES) {
        setError("Vidéo trop lourde (max 50 Mo).");
        return;
      }

      const slotIndex = pendingSlotRef.current ?? mediaItems.length;
      if (slotIndex < 0 || slotIndex >= MAX_MEDIA_ITEMS) return;

      const nextItem: MediaSlot = {
        kind: "video",
        dataUrl: URL.createObjectURL(file),
        fileName: file.name,
        mimeType: file.type || "video/mp4",
        file,
        imageRatio: coverStageRatio,
        offset: { x: 0, y: 0 },
        zoom: 1,
      };
      setMediaItems((prev) => insertMediaSlot(prev, slotIndex, nextItem));
      pendingSlotRef.current = null;
      return;
    }

    const slotIndex = pendingSlotRef.current;
    if (slotIndex == null || slotIndex < 0 || slotIndex >= MAX_MEDIA_ITEMS) return;

    let prepared: Awaited<ReturnType<typeof preparePhotoModifyImage>>;
    try {
      prepared = await preparePhotoModifyImage(file, { forItemDraft: true });
    } catch {
      setError(ITEM_PHOTO_PREPARE_FAILED_MESSAGE);
      return;
    }

    const draftId = crypto.randomUUID();
    let persistableDataUrl: string;
    try {
      persistableDataUrl = await toPersistableDataUrl(prepared.previewUrl);
    } catch {
      setError(ITEM_PHOTO_PREPARE_FAILED_MESSAGE);
      return;
    }
    if (prepared.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(prepared.previewUrl);
    }
    try {
      registerPhotoModifyRuntimeFile(draftId, prepared.file, persistableDataUrl);
      savePhotoModifyDraft({
        id: draftId,
        source: "item",
        returnPath: createReturnPath,
        dataUrl: persistableDataUrl,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        itemId: "community-create",
        slot: slotIndex,
        aspect: coverAspect,
        offset: { x: 0, y: 0 },
        zoom: 1,
        status: "pending",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : ITEM_PHOTO_STORAGE_QUOTA_MESSAGE);
      return;
    }

    persistCoverAspect(coverAspect);
    persistMediaItems(mediaItems);
    persistLinkedItems(selectedItems);
    router.push(`/modify?id=${encodeURIComponent(draftId)}`);
  };

  const removeMediaItem = (index: number) => {
    setMediaItems((prev) => {
      const removed = prev[index];
      if (removed) revokeMediaPreviewUrl(removed);
      const next = prev.filter((_, itemIndex) => itemIndex !== index);
      if (next.length === 0) clearPersistedMediaItems();
      return next;
    });
  };

  function toggleItem(itemId: string) {
    setSelectedItems((prev) => {
      if (prev.some((row) => row.item_id === itemId)) {
        return prev.filter((row) => row.item_id !== itemId);
      }
      if (prev.length >= MAX_LINKED_ITEMS) return prev;
      return [...prev, { item_id: itemId, role_label: "" }];
    });
  }

  async function uploadSlotFiles(userId: string, slots: MediaSlot[]): Promise<string[]> {
    const uploadId = `${Date.now()}-${crypto.randomUUID()}`;
    const paths: string[] = [];

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const file =
        slot.kind === "video" && slot.file
          ? slot.file
          : await dataUrlToFile(slot.dataUrl, slot.fileName, slot.mimeType);
      const ext =
        slot.kind === "video"
          ? file.name.split(".").pop()?.toLowerCase() || "mp4"
          : file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `users/${userId}/inspirations/${uploadId}/${i}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
      if (uploadError) throw new Error(uploadError.message);
      paths.push(path);
    }

    return paths;
  }

  async function handlePublish() {
    setError(null);

    const filledSlots = mediaItems;
    if (filledSlots.length === 0) {
      setError("Ajoute au moins un média.");
      return;
    }

    setPublishing(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Connecte-toi pour publier une inspi.");

      const mediaPaths = await uploadSlotFiles(user.id, filledSlots);
      const isVideo = filledSlots.length === 1 && filledSlots[0].kind === "video";
      const mediaType = isVideo ? "video" : filledSlots.length === 1 ? "photo" : "dump";
      const coverTransform: InspirationCoverTransform | null =
        mediaType === "photo"
          ? {
              offset: { x: filledSlots[0].offset.x, y: filledSlots[0].offset.y },
              zoom: filledSlots[0].zoom,
            }
          : null;

      const result = await publishCommunityInspiration(supabase, {
        title: "",
        caption: "",
        mediaType,
        mediaBucket: BUCKET,
        mediaPaths,
        coverAspect,
        coverTransform,
        itemIds: selectedItems.map((row) => row.item_id),
        roleLabels: selectedItems.map((row) => row.role_label),
      });

      if (!result) {
        setError("Publication impossible. Réessaie dans un instant.");
        return;
      }

      clearPersistedMediaItems();
      clearPersistedLinkedItems();
      clearPersistedCoverAspect();
      router.replace(lookDetailHref(result.id, returnTo));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publication impossible.");
    } finally {
      setPublishing(false);
    }
  }

  const canAddMedia = mediaItems.length < MAX_MEDIA_ITEMS;
  const canReorderMedia = mediaItems.length > 1;

  const renderLinkedItem = (item: ShopCatalogItem) => {
    const selected = selectedItems.some((row) => row.item_id === item.id);
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => toggleItem(item.id)}
          className="flex w-full items-center gap-3 py-3 text-left"
        >
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
            <RemoteCoverThumb photoUrl={coverUrlById[item.id] ?? ""} frameClassName="h-full w-full" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-zinc-900">{item.title}</p>
            <p className="truncate text-[13px] text-zinc-500">{item.brand_label ?? item.category_label ?? ""}</p>
          </div>
          {selected ? (
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
              <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            </span>
          ) : (
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-200"
              aria-hidden
            />
          )}
        </button>
      </li>
    );
  };

  if (publishing) {
    return <AppPageLoading label="Publication" />;
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header className="shrink-0 w-full border-b border-zinc-100 bg-white">
        <div className="flex w-full flex-col px-5 pb-5 pt-[max(1.125rem,calc(env(safe-area-inset-top)+14px))]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => router.push(returnTo)}
              className="-ml-1.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-900"
              aria-label="Retour"
            >
              <ChevronLeft className="h-8 w-8" strokeWidth={2.25} aria-hidden />
            </button>
            <button
              type="button"
              disabled={publishing}
              onClick={() => void handlePublish()}
              className={cn(
                "shrink-0 px-2 text-[18px] font-semibold text-zinc-900",
                publishing && "opacity-50",
              )}
            >
              {publishing ? "…" : "Publier"}
            </button>
          </div>
          <div className="mt-5 flex min-w-0 items-center justify-between gap-3">
            <h1 className={cn("min-w-0 flex-1", segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>
              Partage une tenue
            </h1>
            <InspirationCoverAspectMenu value={coverAspect} onChange={setCoverAspect} />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        <div className="flex min-h-full flex-col bg-white pb-28">
        <section className="bg-white pb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/*,.mov"
            onChange={onPickFile}
            className="hidden"
          />

          {mediaItems.length === 0 ? (
            <div className="px-5">
              <EmptyMediaAddFrame
                className={cn("w-full", coverAspectClass)}
                onClick={openPickerForNew}
                label="Ajouter un média"
              />
            </div>
          ) : (
            <>
              <div className="relative w-full overflow-hidden bg-zinc-200">
                <div
                  ref={heroScrollRef}
                  className="flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {mediaItems.map((slot, index) =>
                    slot.kind === "video" ? (
                      <div
                        key={`hero-${slot.fileName}-${index}`}
                        className="relative block min-w-full flex-[0_0_100%] snap-center snap-always bg-zinc-950"
                      >
                        <div className={cn("relative w-full", coverAspectClass)}>
                          <CreateAmbientVideo src={slot.dataUrl} active={heroIndex === index} />
                        </div>
                      </div>
                    ) : (
                      <button
                        key={`hero-${slot.fileName}-${index}`}
                        type="button"
                        onClick={() => openModifyForSlot(index, slot)}
                        className="relative block min-w-full flex-[0_0_100%] snap-center snap-always border-0 bg-zinc-950 p-0"
                        aria-label={`Modifier la photo ${index + 1}`}
                      >
                        <div className={cn("relative w-full", coverAspectClass)}>
                          <RemoteCoverThumb
                            photoUrl={slot.dataUrl}
                            frameClassName="h-full w-full"
                            coverStyle={slotCoverStyle(slot, coverStageRatio)}
                          />
                        </div>
                      </button>
                    ),
                  )}
                </div>
                <GalleryDots count={mediaItems.length} activeIndex={heroIndex} variant="fullscreen" />
              </div>

              <div className="flex touch-pan-x gap-2 overflow-x-auto px-5 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {mediaItems.map((slot, index) => (
                  <button
                    key={`thumb-${index}-${slot.fileName}`}
                    data-thumb-index={index}
                    type="button"
                    draggable={canReorderMedia}
                    onDragStart={(event) => {
                      setDraggingThumbIndex(index);
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = "move";
                        const transparentPixel = new Image();
                        transparentPixel.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
                        event.dataTransfer.setDragImage(transparentPixel, 0, 0);
                      }
                    }}
                    onDragEnd={resetThumbDragState}
                    onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
                    onDragEnter={() => setDragOverThumbIndex(index)}
                    onDragLeave={() => setDragOverThumbIndex((prev) => (prev === index ? null : prev))}
                    onDrop={() => onDropThumb(index)}
                    onTouchStart={(event) => {
                      if (!canReorderMedia) return;
                      const touch = event.touches[0];
                      if (!touch) return;
                      touchStartRef.current = { x: touch.clientX, y: touch.clientY, index };
                    }}
                    onTouchMove={onTouchMoveThumb}
                    onTouchEnd={onTouchEndThumb}
                    onTouchCancel={onTouchEndThumb}
                    onClick={() => {
                      if (suppressNextThumbClickRef.current) {
                        suppressNextThumbClickRef.current = false;
                        return;
                      }
                      if (slot.kind === "video") {
                        scrollHeroToIndex(index);
                        return;
                      }
                      openModifyForSlot(index, slot);
                    }}
                    className={cn(
                      "relative shrink-0 overflow-hidden rounded-xl bg-zinc-100 transition",
                      canReorderMedia && "cursor-grab active:cursor-grabbing",
                      draggingThumbIndex === index && "touch-none",
                      heroIndex === index ? "ring-2 ring-zinc-900 ring-offset-2" : "opacity-85 hover:opacity-100",
                      dragOverThumbIndex === index && draggingThumbIndex !== null && draggingThumbIndex !== index
                        ? "ring-2 ring-zinc-400 ring-offset-2"
                        : "",
                      draggingThumbIndex === index ? "opacity-40" : "",
                    )}
                    style={{ width: mediaThumbWidthPx, height: mediaThumbHeightPx }}
                    aria-label={slot.kind === "video" ? `Voir la vidéo ${index + 1}` : `Modifier la photo ${index + 1}`}
                    aria-pressed={slot.kind === "video" ? heroIndex === index : undefined}
                  >
                    {slot.kind === "video" ? (
                      <CreateAmbientVideo src={slot.dataUrl} active={heroIndex === index} />
                    ) : (
                      <RemoteCoverThumb
                        photoUrl={slot.dataUrl}
                        frameClassName="h-full w-full"
                        coverStyle={slotCoverStyle(slot, coverStageRatio)}
                      />
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeMediaItem(index);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        removeMediaItem(index);
                      }}
                      className="absolute left-1 top-1 z-[1] inline-flex h-[19px] w-[19px] items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 shadow-sm"
                      aria-label={`Supprimer la photo ${index + 1}`}
                    >
                      <X size={11} strokeWidth={2.8} />
                    </span>
                  </button>
                ))}

                {canAddMedia ? (
                  <EmptyMediaAddFrame
                    className="shrink-0"
                    style={{ width: mediaThumbWidthPx, height: mediaThumbHeightPx }}
                    size="compact"
                    onClick={openPickerForNew}
                    label="Ajouter un média"
                  />
                ) : null}
              </div>
            </>
          )}

          {error ? <p className="px-5 text-[14px] text-rose-600">{error}</p> : null}
        </section>

        <section className="flex min-h-0 flex-1 flex-col border-t border-zinc-100 bg-white px-5 py-4 pb-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.25rem))]">
          <h2 className={cn(segnaPlayfairDisplay.className, SEGNA_SECTION_TITLE_CLASSNAME)}>Pièces liées</h2>

          {selectedCatalogItems.length > 0 ? (
            <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {selectedCatalogItems.map((item) => (
                <div
                  key={`linked-${item.id}`}
                  className="relative shrink-0 overflow-hidden rounded-md bg-zinc-100 ring-2 ring-zinc-900"
                  style={{ width: LINKED_PIECE_THUMB_SIZE_PX, height: LINKED_PIECE_THUMB_SIZE_PX }}
                >
                  {coverUrlById[item.id] ? (
                    <RemoteCoverThumb
                      photoUrl={coverUrlById[item.id]}
                      frameClassName="h-full w-full"
                      photoCoverFill
                    />
                  ) : (
                    <div className="h-full w-full bg-zinc-200" />
                  )}
                  <button
                    type="button"
                    onClick={() => toggleItem(item.id)}
                    className="absolute left-1 top-1 z-[1] inline-flex h-[19px] w-[19px] items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 shadow-sm"
                    aria-label={`Retirer ${item.title}`}
                  >
                    <X size={11} strokeWidth={2.8} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher une pièce…"
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-[14px] outline-none placeholder:text-zinc-400 focus:border-zinc-300"
            />
          </div>

          {isSearching ? (
            <div className="mt-4 space-y-4">
              {filteredWornItems.length > 0 ? (
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                    Pièces que tu as portées
                  </p>
                  <ul className="divide-y divide-zinc-100">{filteredWornItems.map(renderLinkedItem)}</ul>
                </div>
              ) : null}

              {filteredOtherItems.length > 0 ? (
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">Autres pièces</p>
                  <ul className="divide-y divide-zinc-100">{filteredOtherItems.map(renderLinkedItem)}</ul>
                </div>
              ) : null}

              {filteredWornItems.length === 0 && filteredOtherItems.length === 0 ? (
                <p className="text-[14px] text-zinc-500">Aucun résultat pour cette recherche.</p>
              ) : null}
            </div>
          ) : wornItems.length === 0 ? (
            <p className="mt-3 text-[14px] text-zinc-500">Aucune pièce portée pour le moment.</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">{wornItems.map(renderLinkedItem)}</ul>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
