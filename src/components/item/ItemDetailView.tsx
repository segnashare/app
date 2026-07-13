"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;

import { ItemIntakePanel } from "./ItemIntakePanel";
import { needsItemIntakeUi } from "@/lib/items/item-intake-ui";
import { LogisticsRefusalEntryModal } from "./LogisticsRefusalEntryModal";
import { ItemRecoveryStatusModal } from "./ItemRecoveryStatusModal";
import { ItemPhotoBottomActions, ItemPhotoOwnerMenuButton, ItemPhotoStickyHeader } from "./ItemPhotoOverlayActions";
import { ItemViewView } from "./ItemViewView";
import { CartCatalogModeProvider } from "@/components/cart/CartCatalogModeContext";
import { GuestCashRentalCatalogProvider } from "@/components/shop/GuestCashRentalCatalogContext";
import { SEGNA_DIALOG_CARD_CLASS, segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { FetchItemDetailResult, ItemDetailPayload } from "@/lib/items/fetch-item-detail-core";
import type { ItemOutfitLookPayload } from "@/lib/items/fetch-item-outfit-look";
import type { ItemStyleLookSummary } from "@/lib/items/fetch-item-style-looks";
import { buildOuttakeShippingPageHref } from "@/lib/items/outtake-shipping-metadata";
import { fetchItemDetailDataForOwner } from "@/lib/items/fetch-item-detail-client";
import { setItemIntakeListingStage } from "@/lib/items/item-intake";
import {
  acknowledgeIntakeStageForSession,
  getIntakeSessionAckServerStoreSnapshot,
  getIntakeSessionAckStoreSnapshot,
  intakeSessionAckKey,
  parseIntakeSessionAckStoreSnapshot,
  subscribeIntakeSessionAck,
} from "@/lib/items/intake-session-ack";
import {
  invalidateLendItemDetailCache,
  primeLendItemDetailCache,
  readLendItemDetailCache,
} from "@/lib/items/lend-items-detail-cache";
import { useToggleCartItem } from "@/hooks/useToggleCartItem";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";




function canEditDraftItem(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === "draft";
}

function ItemDetailLoadingBody({ navigateBack }: { navigateBack: () => void }) {
  return (
    <div className="mx-auto max-w-[430px] pb-28">
      <div className="relative aspect-[3/4] w-full bg-zinc-100">
        <SegnaSkeletonBlock className="absolute inset-0 h-full w-full" rounded="rounded-none" />
        <ItemPhotoStickyHeader onBack={navigateBack} />
      </div>
      <div className="space-y-4 px-6 pt-5">
        <SegnaSkeletonBlock className="h-5 w-full max-w-[280px]" rounded="rounded-md" />
        <SegnaSkeletonBlock className="h-7 w-24" rounded="rounded-md" />
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <SegnaSkeletonBlock className="h-4 w-full" rounded="rounded-md" />
          <SegnaSkeletonBlock className="h-4 w-full max-w-[90%]" rounded="rounded-md" />
        </div>
      </div>
    </div>
  );
}

const ITEM_DETAIL_BACK_HREF_KEY = "segna:item-detail:back-href";

const ITEM_DETAIL_CACHED_EVENT = "segna:item-detail-cached";

type ItemDetailViewProps = {
  /** Préchargement SSR des frames « Propriété Segna » (membre connecté uniquement côté page). */
  initialSegnaStockPropertyCmsFrames?: CmsFrameRow[];
  /** Session résolue côté serveur : évite un `getUser()` client pour les droits UI (propriétaire). */
  initialAuthUserId?: string | null;
  /** Résultat du chargement fiche côté serveur (évite le waterfall client si présent). */
  initialDetailResult?: FetchItemDetailResult;
  /** Lot expédition groupé par défaut (pièces prêtes du membre). */
  defaultShippingGroupIds?: string[];
  /** Transfer outtake actif (récupération membre). */
  outtakeTransferId?: string | null;
  initialOutfitLook?: ItemOutfitLookPayload | null;
  initialOutfitCompanionItems?: ShopCatalogItem[];
  initialOutfitCompanionCoverUrlById?: Record<string, string>;
  initialStyleLooks?: ItemStyleLookSummary[];
  initialMoreCatalogItems?: ShopCatalogItem[];
  initialMoreCatalogCoverUrlById?: Record<string, string>;
  initialGuestCashRental?: boolean;
};

export function ItemDetailView({
  initialSegnaStockPropertyCmsFrames,
  initialAuthUserId = null,
  initialDetailResult,
  defaultShippingGroupIds = [],
  outtakeTransferId = null,
  initialOutfitLook = null,
  initialOutfitCompanionItems = [],
  initialOutfitCompanionCoverUrlById = {},
  initialStyleLooks = [],
  initialMoreCatalogItems = [],
  initialMoreCatalogCoverUrlById = {},
  initialGuestCashRental = false,
}: ItemDetailViewProps = {}) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const itemId = typeof params.id === "string" ? params.id : null;
  const fromCart = searchParams.get("from") === "cart";
  const fromShop = searchParams.get("from") === "shop";
  /** Strip `?verification=1` après chargement (URL propre). */
  const verificationPending = searchParams.get("verification") === "1";

  /** Depuis le shop sans SSR : ne pas réutiliser le cache « échange » (souvent obsolète pour `item_custom_brand_label`). */
  const [data, setData] = useState<ItemDetailPayload | null>(() => {
    if (initialDetailResult?.ok) return initialDetailResult.payload;
    if (!itemId) return null;
    if (typeof window !== "undefined") {
      try {
        if (new URLSearchParams(window.location.search).get("from") === "shop") return null;
      } catch {
        /* noop */
      }
    }
    return readLendItemDetailCache(itemId);
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (initialDetailResult !== undefined) return false;
    if (!itemId) return false;
    if (typeof window !== "undefined") {
      try {
        if (new URLSearchParams(window.location.search).get("from") === "shop") return true;
      } catch {
        /* noop */
      }
    }
    return readLendItemDetailCache(itemId) == null;
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
    if (initialDetailResult && !initialDetailResult.ok) {
      return initialDetailResult.kind === "auth" ? "Session invalide." : "Pièce introuvable.";
    }
    return null;
  });
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [recoveryStatusOpen, setRecoveryStatusOpen] = useState(false);
  const [recoveryConfirmOpen, setRecoveryConfirmOpen] = useState(false);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const intakeAckSnapshot = useSyncExternalStore(
    subscribeIntakeSessionAck,
    getIntakeSessionAckStoreSnapshot,
    getIntakeSessionAckServerStoreSnapshot,
  );
  const intakeAck = useMemo(
    () => parseIntakeSessionAckStoreSnapshot(intakeAckSnapshot),
    [intakeAckSnapshot],
  );
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const itemIdRef = useRef<string | null>(null);
  itemIdRef.current = itemId;

  const [authUserId, setAuthUserId] = useState<string | null>(() => initialAuthUserId ?? null);
  useEffect(() => {
    if (initialAuthUserId) return;
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getUser().then((res) => {
      setAuthUserId(res.data.user?.id ?? null);
    });
  }, [initialAuthUserId]);

  const navigateBack = useCallback(() => {
    if (fromCart || fromShop) {
      router.back();
      return;
    }
    router.replace("/exchange");
  }, [fromCart, fromShop, router]);

  /**
   * Après soumission, session = /exchange : Retour / Suivant du navigateur ne doit pas rouvrir le flux
   * new item (sous-pages). On laisse passer uniquement /items/[id] et /exchange (pile naturelle).
   */
  useEffect(() => {
    if (!itemId || typeof window === "undefined") return;
    let backHref: string | null = null;
    try {
      backHref = window.sessionStorage.getItem(ITEM_DETAIL_BACK_HREF_KEY);
    } catch {
      return;
    }
    if (backHref !== "/exchange") return;

    const onPopState = () => {
      queueMicrotask(() => {
        const id = itemIdRef.current;
        if (!id) return;
        const path = window.location.pathname;
        if (path === `/items/${id}`) return;
        if (path === "/cart" || path.startsWith("/cart/")) return;
        if (path === "/exchange" || path.startsWith("/exchange/")) return;
        router.replace("/exchange");
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [itemId, router]);

  useEffect(() => {
    if (!itemId || !verificationPending) return;
    const path = pathname && pathname.startsWith("/items/") ? pathname : `/items/${itemId}`;
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete("verification");
    const q = qs.toString();
    router.replace(q ? `${path}?${q}` : path, { scroll: false });
  }, [itemId, pathname, router, searchParams, verificationPending]);

  useEffect(() => {
    if (!itemId) {
      setData(null);
      setIsLoading(false);
      setErrorMessage(null);
      return;
    }
    setErrorMessage(null);
    if (initialDetailResult !== undefined) {
      return;
    }
    if (fromShop) {
      invalidateLendItemDetailCache(itemId);
      setData(null);
      setIsLoading(true);
      return;
    }
    const snap = readLendItemDetailCache(itemId);
    if (snap) {
      setData(snap);
      setIsLoading(false);
    } else {
      setData(null);
      setIsLoading(true);
    }
  }, [itemId, fromShop, initialDetailResult]);

  useEffect(() => {
    if (!itemId || typeof window === "undefined") return;
    const onCached = (e: Event) => {
      const ce = e as CustomEvent<{ itemId?: string }>;
      if (ce.detail?.itemId !== itemId) return;
      const snap = readLendItemDetailCache(itemId);
      if (!snap) return;
      setData(snap);
      setIsLoading(false);
      setErrorMessage(null);
    };
    window.addEventListener(ITEM_DETAIL_CACHED_EVENT, onCached);
    return () => window.removeEventListener(ITEM_DETAIL_CACHED_EVENT, onCached);
  }, [itemId]);

  const fetchData = useCallback(async () => {
    if (!itemId) {
      setData(null);
      setIsLoading(false);
      return;
    }

    if (readLendItemDetailCache(itemId) == null) {
      setIsLoading(true);
    }
    setErrorMessage(null);

    const res = await fetchItemDetailDataForOwner(itemId);
    if (!res.ok) {
      setErrorMessage(res.kind === "auth" ? "Session invalide." : "Pièce introuvable.");
      setData(null);
      setIsLoading(false);
      return;
    }

    primeLendItemDetailCache(itemId, res.payload);
    setData(res.payload);
    setIsLoading(false);
  }, [itemId]);

  const acknowledgeIntakeForSession = useCallback(
    (ackItemId: string, listingStage: string, fulfillmentStage: string | null) => {
      acknowledgeIntakeStageForSession(ackItemId, listingStage, fulfillmentStage);
    },
    [],
  );

  useEffect(() => {
    if (!itemId) return;
    if (initialDetailResult !== undefined) {
      if (initialDetailResult.ok) {
        primeLendItemDetailCache(itemId, initialDetailResult.payload);
      }
      return;
    }
    void fetchData();
  }, [itemId, initialDetailResult, fetchData]);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      const el = actionsMenuRef.current;
      if (el && !el.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [actionsMenuOpen]);

  const { cartItemIds, cartBusyIds, toggleCart } = useToggleCartItem();
  const [isLiked, setIsLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const isOwner = Boolean(authUserId && data && data.ownerUserId === authUserId);
  const showHeaderActions = data ? canEditDraftItem(data.status) && isOwner : false;
  const itemStatus = data?.status?.trim().toLowerCase() ?? "";
  const showCartHeaderAction =
    Boolean(itemId && data && !isOwner && !showHeaderActions) &&
    (itemStatus === "available" || itemStatus === "in_cart");
  const showOutfitSection =
    Boolean(!isOwner && data && (itemStatus === "available" || itemStatus === "in_cart")) &&
    Boolean(initialOutfitLook && initialOutfitCompanionItems.length > 0);
  const showStyleLooksSection =
    Boolean(!isOwner && data && (itemStatus === "available" || itemStatus === "in_cart")) &&
    initialStyleLooks.length > 0;
  const showMoreCatalogSection =
    Boolean(!isOwner && data && (itemStatus === "available" || itemStatus === "in_cart")) &&
    initialMoreCatalogItems.length > 0;
  const itemInCart = Boolean(itemId && cartItemIds.has(itemId));
  const cartToggleBusy = Boolean(itemId && cartBusyIds.has(itemId));
  const intakeAckSessionKey =
    itemId && data?.intake?.listing_stage
      ? intakeSessionAckKey(itemId, data.intake.listing_stage, data.intake.fulfillment_stage)
      : null;
  const intakeListingStage = data?.intake?.listing_stage?.trim().toLowerCase() ?? "";
  const isRefusedIntake = intakeListingStage === "refused";
  const intakeHiddenForSession = !isRefusedIntake && intakeAckSessionKey != null && intakeAck.has(intakeAckSessionKey);
  const showIntakeStrip = Boolean(
    data?.intake &&
      !intakeHiddenForSession &&
      needsItemIntakeUi(data.intake.listing_stage, data.intake.fulfillment_stage),
  );
  const intakeFloatingCard = data?.intake?.listing_stage === "validation_pending";
  const showLogisticsRefusalModal = Boolean(
    data?.intake?.listing_stage === "validated" && data?.intake?.fulfillment_stage === "refused",
  );
  const showRecoveryEntry = data?.status?.trim().toLowerCase() === "retired" && isOwner;
  const recoveryStage = (data?.outtake?.stage ?? "none").trim().toLowerCase();
  const recoveryLabel =
    recoveryStage === "in_transit"
      ? "Expédition retour confirmée"
      : recoveryStage === "member_verification_pending"
        ? "Vérification membre en attente"
        : recoveryStage === "member_issue_reported"
          ? "Incident retour signalé"
          : recoveryStage === "settled"
            ? "Retour finalisé"
            : "Récupération initiée";
  const recoveryHref = buildOuttakeShippingPageHref(outtakeTransferId);
  const canCancelReturn = recoveryStage === "return_open";
  const canMemberConfirmRecovery = recoveryStage === "member_verification_pending";
  const canMemberReportIssue = recoveryStage === "member_verification_pending" || recoveryStage === "member_issue_reported";

  useEffect(() => {
    setRecoveryStatusOpen(showRecoveryEntry);
  }, [showRecoveryEntry, itemId]);

  useEffect(() => {
    if (!itemId || isOwner) {
      setIsLiked(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: row } = await supabase
        .from("item_favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq("item_id", itemId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!cancelled) setIsLiked(Boolean(row?.id));
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, itemId, supabase]);

  const handleToggleLike = useCallback(async () => {
    if (!itemId || likeBusy || isOwner) return;
    setLikeBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const likedNow = isLiked;
      setIsLiked(!likedNow);

      if (likedNow) {
        await supabase
          .from("item_favorites")
          .update({ deleted_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("item_id", itemId)
          .is("deleted_at", null);
        return;
      }

      const { data: existingAny } = await supabase
        .from("item_favorites")
        .select("id,deleted_at")
        .eq("user_id", user.id)
        .eq("item_id", itemId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingAny?.id) {
        await supabase.from("item_favorites").update({ deleted_at: null }).eq("id", existingAny.id);
      } else {
        await supabase.from("item_favorites").insert({ user_id: user.id, item_id: itemId });
      }
    } finally {
      setLikeBusy(false);
    }
  }, [isLiked, isOwner, itemId, likeBusy, supabase]);

  const intakeStripRef = useRef<HTMLDivElement | null>(null);

  const handleConfirmDelete = async () => {
    if (!itemId || isDeleting) return;
    setDeleteError(null);
    setIsDeleting(true);
    const listingStage = data?.intake?.listing_stage?.trim().toLowerCase() ?? "";
    const isOfferRefusal = listingStage === "validation_pending";
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setIsDeleting(false);
      setDeleteError("Session invalide.");
      return;
    }
    const { error } = await supabase
      .from("items")
      .update({ status: isOfferRefusal ? "refused" : "draft_deleted" })
      .eq("id", itemId)
      .eq("owner_user_id", user.id)
      .is("deleted_at", null);
    setIsDeleting(false);
    if (error) {
      setDeleteError(error.message);
      return;
    }
    if (isOfferRefusal) {
      const intakeRes = await setItemIntakeListingStage(supabase, itemId, "refused");
      if (!intakeRes.ok) {
        setDeleteError(intakeRes.message);
        return;
      }
      acknowledgeIntakeStageForSession(
        itemId,
        data?.intake?.listing_stage ?? "validation_pending",
        data?.intake?.fulfillment_stage ?? null,
      );
    }
    try {
      const activeDraftId = window.sessionStorage.getItem("segna:new-item:active-draft-id");
      if (activeDraftId === itemId) {
        window.sessionStorage.removeItem("segna:new-item:active-draft-id");
        window.sessionStorage.removeItem("segna:new-item:slots-draft");
        window.sessionStorage.removeItem("segna:new-item:text-draft");
      }
    } catch {
      // no-op
    }
    invalidateLendItemDetailCache(itemId);
    setDeleteModalOpen(false);
    router.push("/exchange");
  };

  const handleMemberRecoveryConfirm = async () => {
    if (!itemId || recoverySubmitting) return;
    setRecoveryError(null);
    setRecoverySubmitting(true);
    try {
      const res = await fetch("/api/items/outtake/member-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, action: "confirm" }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setRecoveryError(j.error ?? "Confirmation impossible");
        return;
      }
      setRecoveryConfirmOpen(false);
      setRecoveryStatusOpen(false);
      await fetchData();
    } catch {
      setRecoveryError("Confirmation impossible");
    } finally {
      setRecoverySubmitting(false);
    }
  };

  const handleMemberRecoveryHelp = async () => {
    if (!itemId || recoverySubmitting) return;
    setRecoveryError(null);
    setRecoverySubmitting(true);
    try {
      const res = await fetch("/api/items/outtake/member-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, action: "help" }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setRecoveryError(j.error ?? "Signalement impossible");
        return;
      }
      await fetchData();
    } catch {
      setRecoveryError("Signalement impossible");
    } finally {
      setRecoverySubmitting(false);
    }
  };

  if (!itemId) {
    return (
      <main className="min-h-[100dvh] bg-white">
        <p className="p-6 text-sm text-zinc-500">Identifiant invalide.</p>
      </main>
    );
  }

  if (errorMessage) {
    return (
      <main className="min-h-[100dvh] bg-white">
        <div className="relative mx-auto max-w-[430px]">
          <div className="relative aspect-[3/4] w-full bg-zinc-100">
            <ItemPhotoStickyHeader onBack={navigateBack} />
          </div>
          <div className="px-6 py-8">
            <p className="text-sm text-[#E44D3E]">{errorMessage}</p>
            {fromCart ? (
              <button
                type="button"
                onClick={navigateBack}
                className={cn(montserrat.className, "mt-4 block text-left text-[16px] font-semibold text-[#5E3023]")}
              >
                Retour au panier
              </button>
            ) : fromShop ? (
              <button
                type="button"
                onClick={navigateBack}
                className={cn(montserrat.className, "mt-4 block text-left text-[16px] font-semibold text-[#5E3023]")}
              >
                Retour au catalogue
              </button>
            ) : (
              <Link href="/exchange" className={cn(montserrat.className, "mt-4 inline-block text-[16px] font-semibold text-[#5E3023]")}>
                Retour à l&apos;échange
              </Link>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (isLoading || !data) {
    return (
      <main className="min-h-[100dvh] bg-white">
        <ItemDetailLoadingBody navigateBack={navigateBack} />
      </main>
    );
  }

  const deleteModalIsOfferRefusal = data.intake?.listing_stage?.trim().toLowerCase() === "validation_pending";

  const showLikeAction = !isOwner && !showHeaderActions;
  const ownerMenu = showHeaderActions ? (
    <ItemPhotoOwnerMenuButton
      open={actionsMenuOpen}
      onToggle={() => setActionsMenuOpen((o) => !o)}
      menuRef={actionsMenuRef}
      menu={
        actionsMenuOpen ? (
          <ul
            role="menu"
            className="absolute right-0 top-full z-30 mt-2 min-w-[220px] rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
          >
            <li role="none">
              <Link
                role="menuitem"
                href={`/items/new?itemId=${encodeURIComponent(itemId!)}&from=item`}
                className={cn(montserrat.className, "block px-4 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50")}
                onClick={() => setActionsMenuOpen(false)}
              >
                Modifier le brouillon
              </Link>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className={cn(
                  montserrat.className,
                  "w-full px-4 py-3 text-left text-sm font-semibold text-[#E44D3E] hover:bg-red-50",
                )}
                onClick={() => {
                  setActionsMenuOpen(false);
                  setDeleteModalOpen(true);
                }}
              >
                {deleteModalIsOfferRefusal ? "Refuser l'offre" : "Supprimer"}
              </button>
            </li>
          </ul>
        ) : null
      }
    />
  ) : undefined;

  const stickyHeader = {
    onBack: navigateBack,
    showCartNav: !showHeaderActions,
    ownerMenu,
  };

  const photoOverlay = (
    <ItemPhotoBottomActions
      showLike={showLikeAction}
      isLiked={isLiked}
      likeBusy={likeBusy}
      onToggleLike={() => void handleToggleLike()}
      showCart={showCartHeaderAction}
      isInCart={itemInCart}
      cartBusy={cartToggleBusy}
      onToggleCart={() => void toggleCart(itemId!)}
    />
  );

  let afterGallery: ReactNode = null;
  if (showIntakeStrip && data.intake?.listing_stage && !intakeFloatingCard) {
    afterGallery = (
      <div ref={intakeStripRef} className="px-4 pb-2 pt-3">
        <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_4px_20px_-6px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04]">
          <ItemIntakePanel
            key={`${data.intake.listing_stage}-${data.intake.fulfillment_stage ?? ""}`}
            itemId={itemId}
            itemTitle={data.title}
            listingStage={data.intake.listing_stage}
            fulfillmentStage={data.intake.fulfillment_stage}
            intakeMetadata={data.intake.metadata}
            intakeUpdatedAt={data.intake.updated_at}
            offerPricePoints={data.infoCard.pricePoints}
            placement="item"
            defaultShippingGroupIds={defaultShippingGroupIds}
            onEvaluationAcknowledged={() => {
              const listingStage = data.intake?.listing_stage;
              const fulfillmentStage = data.intake?.fulfillment_stage ?? null;
              if (!itemId || !listingStage) return;
              acknowledgeIntakeForSession(itemId, listingStage, fulfillmentStage);
            }}
            onPipelineUpdated={() => void fetchData()}
          />
        </div>
      </div>
    );
  }

  return (
    <GuestCashRentalCatalogProvider guestCashRental={initialGuestCashRental}>
    <CartCatalogModeProvider>
    <main className="min-h-[100dvh] bg-white">

      {itemId && showRecoveryEntry ? (
        <ItemRecoveryStatusModal
          open={recoveryStatusOpen}
          itemId={itemId}
          recoveryLabel={recoveryLabel}
          recoveryHref={recoveryHref}
          recoveryStage={recoveryStage}
          canCancelReturn={canCancelReturn}
          canMemberConfirmRecovery={canMemberConfirmRecovery}
          canMemberReportIssue={canMemberReportIssue}
          recoveryError={recoveryError}
          recoverySubmitting={recoverySubmitting}
          onDismiss={() => setRecoveryStatusOpen(false)}
          onConfirmClick={() => {
            setRecoveryError(null);
            setRecoveryConfirmOpen(true);
          }}
          onHelpClick={() => void handleMemberRecoveryHelp()}
        />
      ) : null}

      {showIntakeStrip && data.intake?.listing_stage && intakeFloatingCard ? (
        <div className="fixed left-0 right-0 top-[calc(env(safe-area-inset-top,0px)+64px)] z-[50] bg-transparent px-4 pt-2.5">
          <div className="mx-auto max-w-[430px]">
            <ItemIntakePanel
              key={`${data.intake.listing_stage}-${data.intake.fulfillment_stage ?? ""}`}
              itemId={itemId}
              itemTitle={data.title}
              listingStage={data.intake.listing_stage}
              fulfillmentStage={data.intake.fulfillment_stage}
              intakeMetadata={data.intake.metadata}
              intakeUpdatedAt={data.intake.updated_at}
              offerPricePoints={data.infoCard.pricePoints}
              placement="item"
              defaultShippingGroupIds={defaultShippingGroupIds}
              onEvaluationAcknowledged={() => {
                const listingStage = data.intake?.listing_stage;
                const fulfillmentStage = data.intake?.fulfillment_stage ?? null;
                if (!itemId || !listingStage) return;
                acknowledgeIntakeForSession(itemId, listingStage, fulfillmentStage);
              }}
              onPipelineUpdated={() => void fetchData()}
            />
          </div>
        </div>
      ) : null}

      <div className="relative z-0 mx-auto max-w-[430px] pb-28">
        <ItemViewView
          title={data.title}
          description={data.description}
          slots={data.slots}
          photosLayout={data.photosLayout}
          infoCard={data.infoCard}
          ownerUserId={data.ownerUserId}
          itemFeedbacks={data.itemFeedbacks}
          wornPhotos={data.wornPhotos}
          outfitLook={showOutfitSection ? initialOutfitLook : null}
          outfitCompanionItems={showOutfitSection ? initialOutfitCompanionItems : []}
          outfitCompanionCoverUrlById={showOutfitSection ? initialOutfitCompanionCoverUrlById : {}}
          styleLooks={showStyleLooksSection ? initialStyleLooks : []}
          moreCatalogItems={showMoreCatalogSection ? initialMoreCatalogItems : []}
          moreCatalogCoverUrlById={showMoreCatalogSection ? initialMoreCatalogCoverUrlById : {}}
          guestCashRental={initialGuestCashRental}
          stickyHeader={stickyHeader}
          photoOverlay={photoOverlay}
          afterGallery={afterGallery}
          showCartCta={showCartHeaderAction}
          isInCart={itemInCart}
          cartCtaBusy={cartToggleBusy}
          onToggleCart={() => void toggleCart(itemId!)}
        />
      </div>

      {deleteModalOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className={cn(SEGNA_DIALOG_CARD_CLASS, "max-w-[430px]")} role="dialog" aria-modal="true" aria-labelledby="item-delete-title">
            <h2 id="item-delete-title" className={segnaDialogTitleClass()}>
              {deleteModalIsOfferRefusal ? "Refuser cette offre ?" : "Supprimer cette pièce ?"}
            </h2>
            <p className={cn(segnaDialogBodyClass(), "mt-2")}>
              {deleteModalIsOfferRefusal
                ? "La pièce restera visible dans tes prêts avec le statut Refusé. Tu pourras ensuite la supprimer définitivement."
                : "Elle sera retirée de ton espace. Tu pourras créer une nouvelle fiche plus tard si besoin."}
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
                {isDeleting ? "Traitement…" : deleteModalIsOfferRefusal ? "Confirmer le refus" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {itemId && recoveryConfirmOpen ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
          <div className={cn(SEGNA_DIALOG_CARD_CLASS, "max-w-[400px]")} role="dialog" aria-modal="true" aria-labelledby="confirm-recovery-title">
            <h2 id="confirm-recovery-title" className={segnaDialogTitleClass()}>
              Tu confirmes avoir récupéré ta pièce ?
            </h2>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={() => void handleMemberRecoveryConfirm()}
                disabled={recoverySubmitting}
                className={cn(
                  montserrat.className,
                  "flex h-11 items-center justify-center rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60",
                )}
              >
                {recoverySubmitting ? "Confirmation…" : "Confirmer"}
              </button>
              <button
                type="button"
                onClick={() => setRecoveryConfirmOpen(false)}
                disabled={recoverySubmitting}
                className={cn(
                  montserrat.className,
                  "h-11 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-800 disabled:opacity-60",
                )}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {itemId && showLogisticsRefusalModal ? <LogisticsRefusalEntryModal itemId={itemId} /> : null}
    </main>
    </CartCatalogModeProvider>
    </GuestCashRentalCatalogProvider>
  );
}
