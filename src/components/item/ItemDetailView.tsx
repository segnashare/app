"use client";

import Link from "next/link";
import { ChevronLeft, MoreVertical, Plus } from "lucide-react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { segnaMontserrat, segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

import { ItemIntakePanel } from "./ItemIntakePanel";
import { needsItemIntakeUi } from "@/lib/items/item-intake-ui";
import { LogisticsRefusalEntryModal } from "./LogisticsRefusalEntryModal";
import { ItemRecoveryStatusModal } from "./ItemRecoveryStatusModal";
import { ItemViewView } from "./ItemViewView";
import { SEGNA_DIALOG_CARD_CLASS, segnaDialogBodyClass, segnaDialogTitleClass } from "@/components/ui/SegnaAppDialog";
import { SegnaSkeletonBlock } from "@/components/ui/SegnaSkeletonBlock";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import type { FetchItemDetailResult, ItemDetailPayload } from "@/lib/items/fetch-item-detail-core";
import type { ItemOutfitLookPayload } from "@/lib/items/fetch-item-outfit-look";
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

function ItemDetailLoadingBody({
  headerRef,
  headerHeight,
  navigateBack,
}: {
  headerRef: RefObject<HTMLElement | null>;
  headerHeight: number;
  navigateBack: () => void;
}) {
  return (
    <>
      <header
        ref={headerRef}
        className="fixed left-0 right-0 top-0 z-[60] border-b border-zinc-200 bg-white px-4 py-6"
      >
        <div className="relative flex min-h-[52px] items-center justify-center">
          <button
            type="button"
            onClick={navigateBack}
            className="absolute left-0 top-1/2 z-10 -translate-y-1/2 p-1"
            aria-label="Retour"
          >
            <ChevronLeft className="h-6 w-6 text-zinc-700" />
          </button>
          <SegnaSkeletonBlock className="mx-12 h-7 w-[min(100%,220px)]" rounded="rounded-lg" />
        </div>
      </header>
      <div
        className="mx-auto max-w-[430px] px-6 pb-12 pt-2"
        style={{ paddingTop: headerHeight }}
      >
        <div className="pb-2">
          <SegnaSkeletonBlock
            className={cn(ITEM_DETAIL_SKELETON_PHOTO_FRAME_CLASS, "w-full border border-zinc-200 shadow-sm")}
            rounded="rounded-2xl"
          />
        </div>
        <div className="pt-2">
          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <SegnaSkeletonBlock className="h-14 w-full max-w-[180px]" rounded="rounded-xl" />
            <SegnaSkeletonBlock className="h-4 w-full" rounded="rounded-md" />
            <SegnaSkeletonBlock className="h-4 w-full max-w-[90%]" rounded="rounded-md" />
            <div className="flex gap-2 pt-1">
              <SegnaSkeletonBlock className="h-9 w-9 shrink-0 rounded-full" rounded="rounded-full" />
              <SegnaSkeletonBlock className="h-9 flex-1 rounded-xl" rounded="rounded-xl" />
            </div>
          </div>
        </div>
        <div className="space-y-4 pt-4">
          <div className="overflow-hidden rounded-2xl border border-zinc-200 px-4 py-3 shadow-sm">
            <SegnaSkeletonBlock className="h-5 w-36" rounded="rounded-md" />
            <div className="mt-3 flex gap-2">
              {[1, 2, 3, 4].map((i) => (
                <SegnaSkeletonBlock key={i} className="aspect-square w-20 shrink-0" rounded="rounded-xl" />
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 py-9 pl-[50px] pr-[60px] shadow-sm">
            <SegnaSkeletonBlock className="h-5 w-28" rounded="rounded-md" />
            <SegnaSkeletonBlock className="mt-4 h-9 w-full max-w-[300px]" rounded="rounded-md" />
            <SegnaSkeletonBlock className="mt-3 h-9 w-full max-w-[260px]" rounded="rounded-md" />
          </div>
        </div>
      </div>
    </>
  );
}

const ITEM_DETAIL_BACK_HREF_KEY = "segna:item-detail:back-href";
const ITEM_DETAIL_SKELETON_PHOTO_FRAME_CLASS = "aspect-[3/4]";

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
  const isOwner = Boolean(authUserId && data && data.ownerUserId === authUserId);
  const showHeaderActions = data ? canEditDraftItem(data.status) && isOwner : false;
  const itemStatus = data?.status?.trim().toLowerCase() ?? "";
  const showCartHeaderAction =
    Boolean(itemId && data && !isOwner && !showHeaderActions) &&
    (itemStatus === "available" || itemStatus === "in_cart");
  const showOutfitSection =
    Boolean(!isOwner && data && (itemStatus === "available" || itemStatus === "in_cart")) &&
    Boolean(initialOutfitLook && initialOutfitCompanionItems.length > 0);
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

  const headerRef = useRef<HTMLElement | null>(null);
  const intakeStripRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(92);
  const [measuredIntakeStripHeight, setMeasuredIntakeStripHeight] = useState(0);
  const intakeStripHeight = showIntakeStrip ? measuredIntakeStripHeight : 0;
  const fixedStripHeight = intakeStripHeight;

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data?.title, showHeaderActions, showCartHeaderAction, isLoading, errorMessage, isOwner]);

  useLayoutEffect(() => {
    if (!showIntakeStrip) return;
    const el = intakeStripRef.current;
    if (!el) return;
    const measure = () => setMeasuredIntakeStripHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showIntakeStrip, data?.intake?.listing_stage, data?.intake?.fulfillment_stage]);

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
        <header
          ref={headerRef}
          className="fixed left-0 right-0 top-0 z-[60] border-b border-zinc-200 bg-white px-4 py-6"
        >
          <div className="flex min-h-[52px] items-center gap-2">
            <button type="button" onClick={navigateBack} className="p-1 -ml-1">
              <ChevronLeft className="h-6 w-6 text-zinc-700" />
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[430px] px-6 py-12" style={{ paddingTop: headerHeight }}>
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
      </main>
    );
  }

  if (isLoading || !data) {
    return (
      <main className="min-h-[100dvh] bg-white">
        <ItemDetailLoadingBody
          headerRef={headerRef}
          headerHeight={headerHeight}
          navigateBack={navigateBack}
        />
      </main>
    );
  }

  const deleteModalIsOfferRefusal = data.intake?.listing_stage?.trim().toLowerCase() === "validation_pending";

  return (
    <main className="min-h-[100dvh] bg-white">
      <header
        ref={headerRef}
        className="fixed left-0 right-0 top-0 z-[60] border-b border-zinc-200 bg-white px-4 py-6"
      >
        <div className="relative flex min-h-[52px] items-center justify-center">
          <button
            type="button"
            onClick={navigateBack}
            className="absolute left-0 top-1/2 z-10 -translate-y-1/2 p-1"
            aria-label="Retour"
          >
            <ChevronLeft className="h-6 w-6 text-zinc-700" />
          </button>
          <h1
            className={cn(
              playfairDisplay.className,
              "mx-12 max-w-[min(100%,280px)] truncate text-center text-[20px] font-extrabold italic text-zinc-900 sm:max-w-[min(100%,340px)]",
            )}
          >
            {data.title}
          </h1>
          {showHeaderActions ? (
            <div ref={actionsMenuRef} className="absolute right-0 top-1/2 z-10 -translate-y-1/2">
              <button
                type="button"
                onClick={() => setActionsMenuOpen((o) => !o)}
                className="rounded-lg p-2 text-zinc-700 hover:bg-zinc-100"
                aria-expanded={actionsMenuOpen}
                aria-haspopup="menu"
                aria-label="Actions sur la pièce"
              >
                <MoreVertical className="h-5 w-5" />
              </button>
              {actionsMenuOpen ? (
                <ul
                  role="menu"
                  className="absolute right-0 top-full mt-1 min-w-[220px] rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
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
              ) : null}
            </div>
          ) : showCartHeaderAction ? (
            <button
              type="button"
              onClick={() => void toggleCart(itemId!)}
              disabled={cartToggleBusy}
              className={cn(
                "absolute right-0 top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full shadow-sm transition-opacity disabled:opacity-50",
                itemInCart
                  ? "bg-zinc-900 text-white ring-1 ring-black/10"
                  : "border border-zinc-900 bg-white text-zinc-900",
              )}
              title={itemInCart ? "Retirer du panier" : "Ajouter au panier"}
              aria-label={itemInCart ? "Retirer du panier" : "Ajouter au panier"}
            >
              <Plus className={cn("h-4 w-4 transition-transform duration-200", itemInCart && "rotate-45")} aria-hidden />
            </button>
          ) : (
            <div className="absolute right-0 top-1/2 h-11 w-11 -translate-y-1/2" aria-hidden />
          )}
        </div>
      </header>

      {showIntakeStrip && data.intake?.listing_stage ? (
        <div
          ref={intakeStripRef}
          className={cn(
            "fixed left-0 right-0 z-[50]",
            intakeFloatingCard ? "bg-transparent pt-2.5" : "bg-transparent px-4 pt-3 sm:px-5",
          )}
          style={{ top: headerHeight }}
        >
          {intakeFloatingCard ? (
            <div className="mx-4 max-w-[430px] sm:mx-auto">
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
          ) : (
            <div className="mx-auto w-full max-w-[460px]">
              <div
                className={cn(
                  "overflow-hidden rounded-2xl border shadow-[0_4px_20px_-6px_rgba(0,0,0,0.12)] ring-1",
                  "border-zinc-200/90 bg-white ring-black/[0.04]",
                )}
              >
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
          )}
        </div>
      ) : null}

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

      <div
        className="relative z-0 mx-auto max-w-[430px] px-6 pb-6"
        style={{ paddingTop: headerHeight + fixedStripHeight }}
      >
        <ItemViewView
          title={data.title}
          description={data.description}
          slots={data.slots}
          photosLayout={data.photosLayout}
          infoCard={data.infoCard}
          ownerUserId={data.ownerUserId}
          segnaStockPropertyCmsFrames={initialSegnaStockPropertyCmsFrames}
          itemFeedbacks={data.itemFeedbacks}
          wornPhotos={data.wornPhotos}
          outfitLook={showOutfitSection ? initialOutfitLook : null}
          outfitCompanionItems={showOutfitSection ? initialOutfitCompanionItems : []}
          outfitCompanionCoverUrlById={showOutfitSection ? initialOutfitCompanionCoverUrlById : {}}
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
  );
}
