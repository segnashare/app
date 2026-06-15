"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Flag, Ban, Ellipsis, UserRound, X } from "lucide-react";

import { CardBase } from "@/components/layout/CardBase";
import type { ItemInfoCardData } from "@/components/item/ItemInfoCard";
import { ItemViewView, type ItemViewSlot } from "@/components/item/ItemViewView";
import { ProfileView } from "@/components/profile/ProfileView";
import { useProfileViewData } from "@/components/profile/useProfileViewData";
import type { ProfileViewData } from "@/components/profile/ProfileView";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSignedUrlForStoragePath } from "@/lib/supabase/storage-resolve-signed-url";
import { parseItemPhotosLayout } from "@/lib/items/item-photo-layout";

type FeedItemCard = {
  kind: "item";
  id: string;
  title: string;
  description: string;
  pricePoints: number | null;
  status: string;
  ownerUserId: string;
  ownerDisplayName: string | null;
  rawPhotos: unknown;
  categorie: string | null;
  sizeLabel: string | null;
  materialsLabel: string | null;
  colorLabel: string | null;
  brandLabel: string | null;
  conditionLabel: string | null;
};

type FeedProfileCard = {
  kind: "profile";
  id: string;
  displayName: string;
  city: string | null;
  age: number | null;
};

type FeedCard = FeedItemCard | FeedProfileCard;

type HomeFeedV1Props = {
  initialCards: FeedCard[];
  initialLikedItemIds: string[];
  initialCursor: { score: number; entity_id: string } | null;
  initialAdBanner: {
    id: string;
    placementKey: string;
    title: string;
    imageUrl: string;
    targetUrl: string;
  } | null;
};

function cardKey(card: FeedCard) {
  return `${card.kind}:${card.id}`;
}

function pointsLabel(points: number | null) {
  if (typeof points !== "number" || Number.isNaN(points)) return "Points n/a";
  return `${points} points`;
}

function buildItemInfoCard(card: FeedItemCard): ItemInfoCardData {
  const brandDisplay =
    (card.brandLabel ?? "").trim() || (card.categorie ?? "-");
  return {
    pricePoints: card.pricePoints,
    ratingValue: "5.0",
    ratingStars: 5,
    size: card.sizeLabel ?? "-",
    materials: card.materialsLabel ?? "-",
    color: card.colorLabel ?? "-",
    brand: brandDisplay,
    condition: card.conditionLabel ?? "-",
  };
}

function parsePhotoEntriesFromItemPhotos(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== "object") return [];
  const photos = raw as Record<string, unknown>;
  return Object.entries(photos)
    .filter(([key, value]) => key.toLowerCase().startsWith("photo") && value && typeof value === "object")
    .sort(([keyA], [keyB]) => {
      const indexA = Number(keyA.toLowerCase().replace("photo", ""));
      const indexB = Number(keyB.toLowerCase().replace("photo", ""));
      if (Number.isNaN(indexA) || Number.isNaN(indexB)) return keyA.localeCompare(keyB);
      return indexA - indexB;
    })
    .map(([, value]) => value as Record<string, unknown>);
}

function FeedProfileVisualization({ profileUserId, displayName }: { profileUserId: string; displayName: string }) {
  const { data, isLoading } = useProfileViewData(profileUserId, displayName);
  return <ProfileView mode="vue_etrangere" data={data as ProfileViewData | null} isLoading={isLoading} />;
}

export function HomeFeedV1({ initialCards, initialLikedItemIds, initialCursor, initialAdBanner }: HomeFeedV1Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const rpcUntyped = useMemo(
    () =>
      async (fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }> =>
        (supabase.rpc as unknown as (
          fn: string,
          args?: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message?: string } | null }>)(fn, args),
    [supabase],
  );
  const [cards, setCards] = useState<FeedCard[]>(initialCards);
  const [index, setIndex] = useState(0);
  const [likedItemIds, setLikedItemIds] = useState<Set<string>>(new Set(initialLikedItemIds));
  const [impressionsByKey, setImpressionsByKey] = useState<Record<string, string>>({});
  const [nextCursor, setNextCursor] = useState<{ score: number; entity_id: string } | null>(initialCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isTabBarVisible, setIsTabBarVisible] = useState(true);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [isDisliking, setIsDisliking] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [availableLikeModalOpen, setAvailableLikeModalOpen] = useState(false);
  const [itemSlotsById, setItemSlotsById] = useState<Record<string, Array<ItemViewSlot | null>>>({});
  const itemSlotsLoadingRef = useRef<Set<string>>(new Set());

  const currentCard = cards[index] ?? null;
  const currentKey = currentCard ? cardKey(currentCard) : null;
  const targetProfileUserId = currentCard
    ? currentCard.kind === "item"
      ? currentCard.ownerUserId
      : currentCard.id
    : null;
  const targetProfileDisplayName = currentCard
    ? currentCard.kind === "item"
      ? currentCard.ownerDisplayName ?? "Membre Segna"
      : currentCard.displayName
    : "Membre Segna";

  useEffect(() => {
    let cancelled = false;
    async function logImpression() {
      if (!currentCard || !currentKey) return;
      if (impressionsByKey[currentKey]) return;

      const args =
        currentCard.kind === "item"
          ? {
              p_entity_type: "item",
              p_item_id: currentCard.id,
              p_profile_user_id: null,
              p_position: index,
              p_feed_surface: "home_v1",
            }
          : {
              p_entity_type: "profile",
              p_item_id: null,
              p_profile_user_id: currentCard.id,
              p_position: index,
              p_feed_surface: "home_v1",
            };

      const impressionRes = await rpcUntyped("record_member_feed_impression", args);
      const data = impressionRes?.data;
      const error = impressionRes?.error;
      if (!cancelled && !error && typeof data === "string" && data.length > 0) {
        setImpressionsByKey((previous) => ({ ...previous, [currentKey]: data }));
      }
    }
    void logImpression();
    return () => {
      cancelled = true;
    };
  }, [currentCard, currentKey, impressionsByKey, index, supabase]);

  useEffect(() => {
    async function resolveItemSlots(card: FeedItemCard) {
      if (itemSlotsById[card.id]) return;
      if (itemSlotsLoadingRef.current.has(card.id)) return;
      itemSlotsLoadingRef.current.add(card.id);
      const entries = parsePhotoEntriesFromItemPhotos(card.rawPhotos).slice(0, 6);
      const emptySlots: Array<ItemViewSlot | null> = [null, null, null, null, null, null];

      const resolveEntry = async (entry: Record<string, unknown>, indexEntry: number) => {
          const storagePathRaw = entry.storage_path ?? entry.storagePath ?? entry.url ?? entry.photo_url ?? entry.photoUrl;
          const storagePath = typeof storagePathRaw === "string" && storagePathRaw.trim() ? storagePathRaw.trim() : null;
          if (!storagePath) return;
          const explicitBucket =
            (typeof entry.bucket_id === "string" && entry.bucket_id) ||
            (typeof entry.storage_bucket === "string" && entry.storage_bucket) ||
            (typeof entry.bucket === "string" && entry.bucket) ||
            null;
          const signedUrl = await createSignedUrlForStoragePath(supabase, storagePath, 60 * 60 * 24, {
            explicitBucket,
          });
          if (!signedUrl) return;

          const positionRaw = entry.position && typeof entry.position === "object" ? (entry.position as Record<string, unknown>) : null;
          const offsetRaw = positionRaw?.offset && typeof positionRaw.offset === "object" ? (positionRaw.offset as Record<string, unknown>) : null;
          const offsetX = typeof offsetRaw?.x === "number" ? offsetRaw.x : 0;
          const offsetY = typeof offsetRaw?.y === "number" ? offsetRaw.y : 0;
          const zoom = typeof positionRaw?.zoom === "number" ? positionRaw.zoom : 1;
          const resolvedSlot: ItemViewSlot = {
            dataUrl: signedUrl,
            offset: { x: offsetX, y: offsetY },
            zoom,
          };
          setItemSlotsById((previous) => {
            const nextSlots = previous[card.id] ? [...previous[card.id]] : [...emptySlots];
            nextSlots[indexEntry] = resolvedSlot;
            return { ...previous, [card.id]: nextSlots };
          });
      };

      try {
        // Prioritize first image for near-instant visual display.
        if (entries[0]) {
          await resolveEntry(entries[0], 0);
        }
        await Promise.all(
          entries.slice(1).map((entry, indexEntry) => resolveEntry(entry, indexEntry + 1)),
        );
      } finally {
        itemSlotsLoadingRef.current.delete(card.id);
      }
    }

    async function prefetchVisibleItemCards() {
      const itemCards = cards
        .slice(index, index + 6)
        .filter((card): card is FeedItemCard => card.kind === "item" && !itemSlotsById[card.id]);
      await Promise.all(itemCards.map((card) => resolveItemSlots(card)));
    }

    void prefetchVisibleItemCards();
  }, [cards, index, itemSlotsById, supabase]);

  useEffect(() => {
    const onTabBarVisibility = (event: Event) => {
      const customEvent = event as CustomEvent<{ visible?: boolean }>;
      setIsTabBarVisible(Boolean(customEvent.detail?.visible));
    };

    window.addEventListener("segna:tabbar-visibility", onTabBarVisibility as EventListener);
    return () => window.removeEventListener("segna:tabbar-visibility", onTabBarVisibility as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadMore() {
      if (!nextCursor) return;
      if (isLoadingMore) return;
      if (index < cards.length - 3) return;
      setIsLoadingMore(true);
      const feedRes = await rpcUntyped("get_home_feed_v1", {
        p_limit: 20,
        p_cursor_score: nextCursor.score,
        p_cursor_entity_id: nextCursor.entity_id,
        p_exploration_ratio: 0.2,
      });
      const data = feedRes?.data;
      const error = feedRes?.error;
      if (cancelled) return;
      setIsLoadingMore(false);
      if (error) return;

      const payload = (data ?? { cards: [], next_cursor: null }) as {
        cards?: Array<{
          kind: "item" | "profile";
          item_id?: string | null;
          profile_user_id?: string | null;
          owner_user_id?: string | null;
          profile_display_name?: string | null;
          title?: string | null;
          description?: string | null;
          price_points?: number | null;
          status?: string | null;
          photos?: unknown;
          category_label?: string | null;
          categorie?: string | null;
          size_label?: string | null;
          materials_label?: string | null;
          color_label?: string | null;
          brand_label?: string | null;
          condition_label?: string | null;
          profile_city?: string | null;
          profile_age?: number | null;
        }>;
        next_cursor?: { score: number; entity_id: string } | null;
      };

      const nextCards: FeedCard[] = [];
      for (const card of payload.cards ?? []) {
        if (card.kind === "item" && card.item_id && card.status) {
          nextCards.push({
            kind: "item",
            id: card.item_id,
            title: card.title ?? "Piece",
            description: card.description ?? "",
            pricePoints: card.price_points ?? null,
            status: card.status,
            ownerUserId: card.owner_user_id ?? "",
            ownerDisplayName: (card.profile_display_name ?? "").trim() || null,
            rawPhotos: card.photos ?? null,
            categorie: card.categorie ?? card.category_label ?? null,
            sizeLabel: card.size_label ?? null,
            materialsLabel: card.materials_label ?? null,
            colorLabel: card.color_label ?? null,
            brandLabel: card.brand_label ?? null,
            conditionLabel: card.condition_label ?? null,
          });
          continue;
        }
        if (card.kind === "profile" && card.profile_user_id) {
          nextCards.push({
            kind: "profile",
            id: card.profile_user_id,
            displayName: (card.profile_display_name ?? "").trim() || "Membre Segna",
            city: card.profile_city ?? null,
            age: typeof card.profile_age === "number" ? card.profile_age : null,
          });
        }
      }

      setCards((previous) => {
        const existing = new Set(previous.map((card) => cardKey(card)));
        const deduped = nextCards.filter((card) => !existing.has(cardKey(card)));
        return [...previous, ...deduped];
      });
      setNextCursor(payload.next_cursor ?? null);
    }
    void loadMore();
    return () => {
      cancelled = true;
    };
  }, [cards.length, index, isLoadingMore, nextCursor, supabase]);

  function advanceToNextCardByRemovingCurrent() {
    setCards((previous) => {
      if (!previous[index]) return previous;
      const next = [...previous];
      next.splice(index, 1);
      return next;
    });
    setIndex((previousIndex) => {
      const maxIndex = Math.max(0, cards.length - 2);
      return Math.min(previousIndex, maxIndex);
    });
  }

  if (!currentCard) {
    return (
      <CardBase className="py-10 text-center">
        <p className="text-sm font-semibold text-zinc-900">Tu as tout vu pour le moment.</p>
        <p className="mt-1 text-sm text-zinc-600">Reviens plus tard pour découvrir de nouveaux profils et pièces.</p>
      </CardBase>
    );
  }

  async function handleDislikeCurrentCard() {
    if (!currentCard || !currentKey || isDisliking) return;
    setIsDisliking(true);
    try {
      const impressionId = impressionsByKey[currentKey] ?? null;
      if (currentCard.kind === "item") {
        await rpcUntyped("record_member_item_interaction", {
          p_item_id: currentCard.id,
          p_interaction_type: "pass",
          p_source_surface: "home_v1",
          p_impression_id: impressionId,
          p_metadata: { trigger: "dislike_button" },
        });
      } else {
        await rpcUntyped("record_member_profile_interaction", {
          p_profile_user_id: currentCard.id,
          p_interaction_type: "pass",
          p_source_surface: "home_v1",
          p_impression_id: impressionId,
          p_metadata: { trigger: "dislike_button" },
        });
      }
    } finally {
      // Advance immediately in all cases to keep UX responsive.
      advanceToNextCardByRemovingCurrent();
      setIsDisliking(false);
    }
  }

  async function ensureActiveCartId(userId: string): Promise<string | null> {
    const { data: existingCart } = await supabase
      .from("carts")
      .select("id,status")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingCart?.id) return existingCart.id as string;
    const { data: createdCart } = await supabase
      .from("carts")
      .insert({ user_id: userId, status: "active" })
      .select("id")
      .single();
    return (createdCart?.id as string | undefined) ?? null;
  }

  async function addItemToCartForCurrentMember(itemId: string): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const cartId = await ensureActiveCartId(user.id);
    if (!cartId) return false;
    const { data: existingLine } = await supabase
      .from("cart_items")
      .select("id")
      .eq("cart_id", cartId)
      .eq("item_id", itemId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existingLine?.id) return true;
    const { error } = await supabase.from("cart_items").insert({
      cart_id: cartId,
      item_id: itemId,
      owner_user_id: user.id,
      status: "in_cart",
    });
    return !error;
  }

  async function commitLikeForCurrentCard(options?: { addToCart?: boolean }) {
    if (!currentCard || !currentKey || isLiking) return;
    setIsLiking(true);
    try {
      const impressionId = impressionsByKey[currentKey] ?? null;
      if (currentCard.kind === "item") {
        await rpcUntyped("record_member_item_interaction", {
          p_item_id: currentCard.id,
          p_interaction_type: "like",
          p_source_surface: "home_v1",
          p_impression_id: impressionId,
          p_metadata: { trigger: "like_button" },
        });
        setLikedItemIds((previous) => new Set([...previous, currentCard.id]));

        if (options?.addToCart && currentCard.status === "available") {
          const added = await addItemToCartForCurrentMember(currentCard.id);
          if (added) {
            window.dispatchEvent(new CustomEvent("segna:cart-changed"));
            await rpcUntyped("record_member_item_interaction", {
              p_item_id: currentCard.id,
              p_interaction_type: "cart_add",
              p_source_surface: "home_v1",
              p_impression_id: impressionId,
              p_metadata: { trigger: "like_modal_add_to_cart" },
            });
          }
        }
      } else {
        await rpcUntyped("record_member_profile_interaction", {
          p_profile_user_id: currentCard.id,
          p_interaction_type: "like",
          p_source_surface: "home_v1",
          p_impression_id: impressionId,
          p_metadata: { trigger: "like_button" },
        });
      }
    } finally {
      advanceToNextCardByRemovingCurrent();
      setIsLiking(false);
      setAvailableLikeModalOpen(false);
    }
  }

  function handleLikeFromFrame() {
    if (!currentCard || isLiking) return;
    if (currentCard.kind === "item" && currentCard.status === "available") {
      setAvailableLikeModalOpen(true);
      return;
    }
    void commitLikeForCurrentCard({ addToCart: false });
  }

  async function handleAddToCartFromFrame() {
    if (!currentCard || !currentKey || currentCard.kind !== "item" || currentCard.status !== "available" || isLiking) return;
    setIsLiking(true);
    try {
      const impressionId = impressionsByKey[currentKey] ?? null;
      const added = await addItemToCartForCurrentMember(currentCard.id);
      if (added) {
        window.dispatchEvent(new CustomEvent("segna:cart-changed"));
        await rpcUntyped("record_member_item_interaction", {
          p_item_id: currentCard.id,
          p_interaction_type: "cart_add",
          p_source_surface: "home_v1",
          p_impression_id: impressionId,
          p_metadata: { trigger: "add_button" },
        });
      }
    } finally {
      advanceToNextCardByRemovingCurrent();
      setIsLiking(false);
    }
  }

  return (
    <section className="space-y-4">
      {initialAdBanner ? (
        <a
          href={initialAdBanner.targetUrl}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
        >
          <img
            src={initialAdBanner.imageUrl}
            alt={initialAdBanner.title}
            className="h-[128px] w-full object-cover"
          />
        </a>
      ) : null}
      <header className="fixed inset-x-0 top-0 z-30 mx-auto w-full max-w-[430px] bg-white px-6 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-zinc-950">
                {currentCard.kind === "item" ? currentCard.title : currentCard.displayName}
              </h2>
            </div>
            <p className="mt-0 text-sm font-semibold text-zinc-900">
              {currentCard.kind === "item"
                ? (currentCard.brandLabel ?? "").trim() || "Marque"
                : ([currentCard.age ? `${currentCard.age} ans` : null, currentCard.city].filter(Boolean).join(" · ") || "Profil membre")}
            </p>
          </div>

          <button
            type="button"
            aria-label="Options"
            onClick={() => setIsActionsOpen(true)}
            className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-800 transition hover:bg-zinc-100"
          >
            <Ellipsis className="h-6 w-6" />
          </button>
        </div>
      </header>
      <div aria-hidden className="h-[72px]" />

      {currentCard.kind === "item" ? (
        <div className="space-y-2">
          <div className="bg-white">
            <ItemViewView
              title={currentCard.title}
              description={currentCard.description}
              slots={itemSlotsById[currentCard.id] ?? [null, null, null, null, null, null]}
              photosLayout={parseItemPhotosLayout(currentCard.rawPhotos)}
              infoCard={buildItemInfoCard(currentCard)}
              ownerUserId={currentCard.ownerUserId}
              onLikeFrame={likedItemIds.has(currentCard.id) ? undefined : handleLikeFromFrame}
              onFrameAction={
                likedItemIds.has(currentCard.id) && currentCard.status === "available"
                  ? () => {
                      void handleAddToCartFromFrame();
                    }
                  : undefined
              }
              frameActionVariant={likedItemIds.has(currentCard.id) ? "plus" : "heart"}
              hideFrameLikeButtons={likedItemIds.has(currentCard.id) && currentCard.status !== "available"}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-600">
            {[currentCard.age ? `${currentCard.age} ans` : null, currentCard.city].filter(Boolean).join(" · ") || "Profil membre"}
          </p>
          <div className="bg-white">
            <FeedProfileVisualization profileUserId={currentCard.id} displayName={currentCard.displayName} />
          </div>
        </div>
      )}
      {isLoadingMore ? <p className="text-xs text-zinc-500">Chargement de nouvelles cartes...</p> : null}

      <div
        className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
        style={{
          bottom: isTabBarVisible
            ? "calc(56px + env(safe-area-inset-bottom) + 12px)"
            : "calc(env(safe-area-inset-bottom) + 12px)",
        }}
      >
        <div className="pointer-events-none flex w-full max-w-[430px] justify-start pl-4">
          <button
            type="button"
            aria-label="Dislike"
            onClick={() => {
              void handleDislikeCurrentCard();
            }}
            disabled={isDisliking}
            className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full bg-white/95 text-zinc-950 shadow-lg ring-1 ring-zinc-200 backdrop-blur-sm transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
          >
            <X className="h-7 w-7" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {isActionsOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/35 px-4 pt-4" onClick={() => setIsActionsOpen(false)}>
          <div
            className="absolute inset-x-4 mx-auto w-full max-w-[430px] rounded-2xl bg-white p-3 shadow-2xl"
            style={{
              bottom: isTabBarVisible
                ? "calc(56px + env(safe-area-inset-bottom) + 16px)"
                : "calc(env(safe-area-inset-bottom) + 16px)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              disabled={isActionBusy}
              onClick={async () => {
                if (!currentCard || currentCard.kind !== "item") return;
                setIsActionBusy(true);
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                if (user) {
                  await supabase.from("item_reports").insert({
                    item_id: currentCard.id,
                    reporter_user_id: user.id,
                    reason: "feed_signalement",
                  });
                }
                setIsActionBusy(false);
                setIsActionsOpen(false);
              }}
              className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            >
              <Flag className="h-5 w-5" />
              <span className="text-sm font-medium">Signaler</span>
            </button>

            <button
              type="button"
              disabled={isActionBusy || !targetProfileUserId}
              onClick={async () => {
                if (!targetProfileUserId) return;
                setIsActionBusy(true);
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                if (user) {
                  await supabase.from("user_blocks").insert({
                    blocked_by_user_id: user.id,
                    blocked_user_id: targetProfileUserId,
                  });
                }
                setIsActionBusy(false);
                setIsActionsOpen(false);
              }}
              className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            >
              <Ban className="h-5 w-5" />
              <span className="text-sm font-medium">Bloquer</span>
            </button>

            <button
              type="button"
              disabled={!targetProfileUserId}
              onClick={() => {
                if (!targetProfileUserId) return;
                setCards((previous) => {
                  const next = [...previous];
                  const profileCard: FeedProfileCard = {
                    kind: "profile",
                    id: targetProfileUserId,
                    displayName: targetProfileDisplayName,
                    city: null,
                    age: null,
                  };
                  next.splice(index + 1, 0, profileCard);
                  return next;
                });
                setIndex((value) => value + 1);
                setIsActionsOpen(false);
              }}
              className="flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            >
              <UserRound className="h-5 w-5" />
              <span className="text-sm font-medium">Voir profil détentrice</span>
            </button>

            <button
              type="button"
              onClick={() => setIsActionsOpen(false)}
              className="mt-2 flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}

      {availableLikeModalOpen && currentCard?.kind === "item" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div
            className="w-full max-w-[360px] rounded-2xl bg-white p-4 shadow-2xl"
          >
            <p className="text-base font-semibold text-zinc-950">Cet item est disponible.</p>
            <p className="mt-1 text-sm text-zinc-600">Tu veux le mettre en panier ou continuer ?</p>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                type="button"
                disabled={isLiking}
                onClick={() => {
                  void commitLikeForCurrentCard({ addToCart: true });
                }}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                Ajouter au panier
              </button>
              <button
                type="button"
                disabled={isLiking}
                onClick={() => {
                  void commitLikeForCurrentCard({ addToCart: false });
                }}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-800 disabled:opacity-60"
              >
                Continuer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

