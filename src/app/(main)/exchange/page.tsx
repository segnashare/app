import type { ExchangeIntakeBannerItem } from "@/components/exchange/exchange-intake-banner-types";
import { ExchangeHeaderAlertStack } from "@/components/exchange/ExchangeHeaderAlertStack";
import { ExchangePiggybackDepositConfirmModal } from "@/components/exchange/ExchangePiggybackDepositConfirmModal";
import { ExchangeCartSection } from "@/components/exchange/ExchangeCartSection";
import { ExchangeCommercePromo } from "@/components/exchange/ExchangeCommercePromo";
import { ExchangeEmptyFill } from "@/components/exchange/ExchangeEmptyFill";
import { BorrowReturnJjDayBanner } from "@/components/exchange/BorrowReturnJjDayBanner";
import { BorrowReturnOverdueBanner } from "@/components/exchange/BorrowReturnOverdueBanner";
import { ExchangeHeader } from "@/components/exchange/ExchangeHeader";
import { ExchangeInteractionsSection } from "@/components/exchange/ExchangeInteractionsSection";
import { ExchangeLendsDetailPrefetch } from "@/components/exchange/ExchangeLendsDetailPrefetch";
import { ExchangeDynamicCmsSection } from "@/components/exchange/ExchangeDynamicCmsSection";
import { ExchangeLendsSection, type LendItem } from "@/components/exchange/ExchangeLendsSection";
import { MainContent } from "@/components/layout/MainContent";
import { fetchActiveCartLinesForUser } from "@/lib/cart/fetch-active-cart-lines";
import { fetchMemberBorrowReturnJjAlerts } from "@/lib/cart/fetch-member-borrow-return-jj-alerts";
import { fetchMemberBorrowReturnOverdueAlerts } from "@/lib/cart/fetch-member-borrow-return-overdue-alerts";
import { formatBorrowOverdueDaysLabelFr } from "@/lib/cart/format-borrow-overdue-copy";
import { syncMemberBorrowOverdueAccrual } from "@/lib/cart/sync-member-borrow-overdue-accrual";
import { fetchSignedFirstPhotoUrlsByCartIds } from "@/lib/cart/fetch-cart-order-thumbnail-urls";
import { checkoutMetaIndicatesUberDirect } from "@/lib/cart/cart-outbound-delivery-kind";
import { isCartReturnCommitmentMet } from "@/lib/cart/fetch-member-cart-order-detail";
import { fetchLatestConfirmedCartOutboundShipmentSummary } from "@/lib/cart/fetch-outbound-shipment-summary";
import { fetchCartBorrowExtensionDaysByCartIds } from "@/lib/cart/fetch-cart-borrow-extension-days";
import {
  fetchCartBorrowReturnDueAtByCartIds,
  fetchCartMemberReceiptConfirmedAtByCartIds,
} from "@/lib/cart/fetch-cart-borrow-return-due-at";
import {
  ensureMemberReceiptAutoConfirmed,
  isMemberReceiptAutoConfirmDue,
  isMemberReceiptValidated,
} from "@/lib/cart/member-receipt-validation";
import { resolveCartBorrowReturnDueMs } from "@/lib/cart/cart-borrow-return-due";
import { isBorrowReturnAlertPhaseParis, isBorrowReturnOverdueParis } from "@/lib/cart/borrow-return-calendar";
import { borrowOverdueLateDayIndex } from "@/lib/emprunt/borrow-overdue-penalty";
import {
  isBorrowReturnUrgentForExchangeList,
  isBorrowReturnVibrateForExchangeList,
  resolveOutboundBorrowDeliveredAtIso,
} from "@/lib/emprunt/borrow-period";
import {
  getMemberOutboundShipmentPhaseCopy,
  getOutboundShipmentDeliverySubtitle,
} from "@/lib/cart/member-outbound-shipment-copy";
import {
  getMemberReturnShipmentPhaseCopy,
  getReturnShipmentSubtitle,
  isReturnExchangeFinishedForMemberList,
  isReturnShipmentPreDeposit,
} from "@/lib/cart/member-return-shipment-copy";
import { CART_STATUSES_OPEN } from "@/lib/cart/cart-lifecycle";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import {
  fetchCmsSectionPublishedDisplay,
  type CmsSectionPublishedDisplay,
} from "@/lib/cms/fetch-cms-section-published-config";
import { collectCmsShopItemIdsFromFrameRows } from "@/lib/cms/collect-cms-shop-item-ids";
import {
  EXCHANGE_CART_EMPTY_CMS_SECTION_KEY,
  EXCHANGE_LENDS_EMPTY_CMS_SECTION_KEY,
  isExchangeGuestRedundantPretsModularSection,
} from "@/lib/cms/echange-section-order";
import { fetchEchangeSectionOrder } from "@/lib/cms/fetch-echange-section-order";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";
import {
  effectiveCatalogSortRank,
  lendPipelineRank,
  needsItemIntakeUi,
} from "@/lib/items/item-intake-ui";
import { fetchMemberPiggybackDepositConfirmQueue } from "@/lib/items/intake-cart-return-piggyback";
import { dedupeIntakeBannerCandidatesForMergedShipping } from "@/lib/items/intake-shipping-metadata";
import { createPerfTracker } from "@/lib/perf/server-timing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseUserWalletPointsRow } from "@/lib/wallet/user-wallet-row";
import { createSignedUrlsForStoragePaths } from "@/lib/supabase/storage-resolve-signed-url";

function toMembershipLabel(roles: string[]): "Guest" | "Membre +" | "Membre X" {
  const normalized = roles.map((role) => role.trim().toLowerCase());
  if (normalized.some((role) => role.includes("segna_x") || role.includes("membre_x") || role.includes("premium") || role.includes("member_x"))) {
    return "Membre X";
  }
  if (normalized.some((role) => role.includes("segna_plus") || role.includes("membre_plus") || role.includes("plus") || role.includes("member_plus"))) {
    return "Membre +";
  }
  return "Guest";
}

type MembershipState = {
  plan_code?: string | null;
  subscription_status?: string | null;
  included_lends_limit?: number | null;
};

function parseIncludedLendsLimitRpc(data: unknown): number {
  if (data == null || typeof data !== "object") return 0;
  const v = (data as Record<string, unknown>).included_lends_limit;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

/** Plafond prêts : priorité à la ligne `user_monthly_entitlements` (RPC), sinon valeurs produit. */
function resolveIncludedLendsLimit(
  membershipLabel: "Guest" | "Membre +" | "Membre X",
  fromRpc: number,
): number {
  if (fromRpc > 0) return fromRpc;
  if (membershipLabel === "Membre X") return 10;
  if (membershipLabel === "Membre +") return 5;
  return 0;
}

function toMembershipLabelFromBilling(state: MembershipState | null | undefined): "Guest" | "Membre +" | "Membre X" {
  const status = (state?.subscription_status ?? "").toLowerCase();
  const planCode = (state?.plan_code ?? "").toLowerCase();
  const isActive = status === "active" || status === "trialing";
  if (!isActive) return "Guest";
  if (planCode === "segna_x") return "Membre X";
  if (planCode === "segna_plus") return "Membre +";
  return "Guest";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

type ResolvedPhotoData = {
  path: string | null;
  position: {
    offset?: { x?: number; y?: number };
    zoom?: number;
    aspect?: string;
  } | null;
};

function resolveItemPhotoData(photosRaw: unknown): ResolvedPhotoData {
  if (!photosRaw || typeof photosRaw !== "object") return { path: null, position: null };
  const photos = photosRaw as Record<string, unknown>;
  const candidates = [
    photos.main_url,
    photos.mainUrl,
    photos.cover_url,
    photos.coverUrl,
    photos.primary_url,
    photos.primaryUrl,
    photos.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return { path: candidate.trim(), position: null };
    }
  }

  const photoEntries = Object.entries(photos)
    .filter(([key, value]) => key.toLowerCase().startsWith("photo") && value && typeof value === "object")
    .sort(([keyA], [keyB]) => {
      const idxA = Number(keyA.toLowerCase().replace("photo", ""));
      const idxB = Number(keyB.toLowerCase().replace("photo", ""));
      if (Number.isNaN(idxA) || Number.isNaN(idxB)) return keyA.localeCompare(keyB);
      return idxA - idxB;
    });

  for (const [, value] of photoEntries) {
    const row = value as Record<string, unknown>;
    const pathCandidate = row.storage_path ?? row.storagePath ?? row.url ?? row.photo_url ?? row.photoUrl;
    if (typeof pathCandidate === "string" && pathCandidate.trim()) {
      const positionRaw = row.position && typeof row.position === "object" ? (row.position as Record<string, unknown>) : null;
      const offsetRaw = positionRaw?.offset && typeof positionRaw.offset === "object" ? (positionRaw.offset as Record<string, unknown>) : null;
      return {
        path: pathCandidate.trim(),
        position: {
          offset: {
            x: typeof offsetRaw?.x === "number" ? offsetRaw.x : 0,
            y: typeof offsetRaw?.y === "number" ? offsetRaw.y : 0,
          },
          zoom: typeof positionRaw?.zoom === "number" ? positionRaw.zoom : 1,
          aspect: typeof positionRaw?.aspect === "string" ? positionRaw.aspect : "square",
        },
      };
    }
  }

  const entries = photos.entries;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const urlCandidate = row.url ?? row.photo_url ?? row.photoUrl ?? row.storage_path ?? row.storagePath;
      if (typeof urlCandidate === "string" && urlCandidate.trim()) {
        return { path: urlCandidate.trim(), position: null };
      }
    }
  }
  return { path: null, position: null };
}

/** Blocs 100 % natifs : pas de chargement frames CMS (cf. panier `cart_system_*`). */
const EXCHANGE_NATIVE_SECTION_KEYS = new Set([
  "exchange_system_cart",
  "exchange_system_lends",
  "exchange_system_history",
]);

export default async function ExchangePage() {
  const perf = createPerfTracker("page:/exchange");
  const supabase = (await createSupabaseServerClient()) as any;
  const { user } = await perf.measure("auth.getUser", getCurrentAuthUser);

  if (!user) {
    return null;
  }

  const userId = user.id as string;

  const [membershipStateRes, subscriptionRowRes, rolesRes, walletRes, activeCartRes, lendsRes, ongoingRes, historyRes, intakeBannersRes] =
    (await Promise.all([
    perf.measure("membership.state", () => supabase.rpc("get_current_membership_state")),
    perf.measure("subscription.latest", () =>
    supabase
      .from("user_subscriptions")
      .select("plan_code,status")
      .eq("user_id", userId)
      .eq("provider", "stripe")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ),
    perf.measure("roles.read", () => supabase.from("user_roles").select("role").eq("user_id", userId)),
    perf.measure("wallet.read", () =>
    supabase
      .from("user_wallets")
      .select("balance_points, balance_consumption_points, balance_exchange_points")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle(),
    ),
    perf.measure("cart.active", () =>
    supabase
      .from("carts")
      .select("id,status,updated_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", [...CART_STATUSES_OPEN])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ),
    perf.measure("lends.read", () =>
    supabase
      .from("items")
      .select(
        "id,title,description,price_points,status,photos,item_brand_id,item_custom_brand_label,item_brands(label), item_intake(listing_stage, fulfillment_stage, updated_at, metadata)",
      )
      .eq("owner_user_id", userId)
      .is("deleted_at", null)
      .in("status", ["draft", "draft_deleted", "available", "in_cart", "reserved", "refused", "retired"])
      .order("updated_at", { ascending: false })
      .limit(8),
    ),
    perf.measure("orders.ongoing", () =>
    supabase
      .from("carts")
      .select("id,status,created_at,updated_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("status", "confirmed")
      .order("updated_at", { ascending: false })
      .limit(50),
    ),
    perf.measure("orders.history", () =>
    supabase
      .from("carts")
      .select("id,status,created_at,updated_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", ["archived", "canceled"])
      .order("updated_at", { ascending: false })
      .limit(50),
    ),
    perf.measure("intake.banners", () =>
    supabase
      .from("item_intake")
      .select(
        "item_id,listing_stage,fulfillment_stage,updated_at,metadata, items!inner(id,price_points,status,owner_user_id,deleted_at)",
      )
      .eq("items.owner_user_id", userId)
      .is("items.deleted_at", null)
      .in("items.status", ["draft", "draft_deleted", "available", "in_cart", "reserved", "refused", "retired"])
      .in("listing_stage", ["evaluation", "evaluated", "validation_pending", "refused", "validated"])
      .order("updated_at", { ascending: false })
      .limit(100),
    ),
  ])) as any[];

  const roles: string[] = (rolesRes.data ?? []).map((entry: { role?: string | null }) => entry.role ?? "").filter(Boolean);
  const membershipLabelFromRpc = toMembershipLabelFromBilling((membershipStateRes.data ?? null) as MembershipState | null);
  const subRow = subscriptionRowRes.data as { plan_code?: string | null; status?: string | null } | null;
  const membershipLabelFromSubscriptionTable =
    subscriptionRowRes.error == null && subRow
      ? toMembershipLabelFromBilling({
          plan_code: subRow.plan_code ?? null,
          subscription_status: subRow.status ?? null,
        })
      : ("Guest" as const);
  /** Même ordre que le profil : table Stripe d’abord, puis RPC ; rôles seulement sans ligne `user_subscriptions`. */
  const membershipLabel =
    membershipLabelFromSubscriptionTable !== "Guest"
      ? membershipLabelFromSubscriptionTable
      : membershipLabelFromRpc !== "Guest"
        ? membershipLabelFromRpc
        : subscriptionRowRes.error == null && subRow != null
          ? "Guest"
          : toMembershipLabel(roles);
  const includedLendsLimitFromRpc = parseIncludedLendsLimitRpc(membershipStateRes.data);
  const includedLendsLimit = resolveIncludedLendsLimit(membershipLabel, includedLendsLimitFromRpc);

  const subStatus = (subRow?.status ?? "").toLowerCase();
  const subPlan = (subRow?.plan_code ?? "").toLowerCase();
  const stripeSubscriptionGrantsWallet =
    (subPlan === "segna_x" || subPlan === "segna_plus") && (subStatus === "active" || subStatus === "trialing");

  let walletPoints = parseUserWalletPointsRow(walletRes.data as Record<string, unknown>);
  /** Ré-applique le crédit mensuel consommation (idempotent) si la migration / webhook n’a pas encore tourné. */
  if (stripeSubscriptionGrantsWallet) {
    await perf.measure("billing.entitlementUpsert", () => supabase.rpc("billing_upsert_monthly_entitlement", {
      p_user_id: userId,
      p_plan_code: subPlan,
    }));
    const { data: walletAfter } = (await perf.measure("wallet.refreshAfterEntitlement", () => supabase
      .from("user_wallets")
      .select("balance_points, balance_consumption_points, balance_exchange_points")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle())) as any;
    walletPoints = parseUserWalletPointsRow(walletAfter as Record<string, unknown>);
  }

  const availablePoints = walletPoints.total;

  const activeCart = activeCartRes.data as { id: string; status: string } | null;
  const activeCartId = activeCart?.id ?? null;

  let cartLines = await perf.measure("cart.lines", () => fetchActiveCartLinesForUser(supabase, userId));
  const itemIdsForComp = [...new Set(cartLines.map((l) => l.itemId))];
  if (itemIdsForComp.length > 0) {
    const compRes = (await perf.measure("cart.competition", () =>
      supabase.rpc("get_cart_items_competition_state", { p_item_ids: itemIdsForComp }),
    )) as any;
    if (compRes.error == null) {
      cartLines = mergeCompetitionIntoCartLines(cartLines, compRes.data);
    }
  }
  const activeCartCostPoints =
    cartLines.length > 0 ? cartLines.reduce((sum, line) => sum + line.pricePoints, 0) : null;

  const rawLends: Array<{
    id: string;
    name: string;
    description: string | null;
    brand: string | null;
    currentValue: number | null;
    itemStatus: string;
    intake: {
      listing_stage: string;
      fulfillment_stage: string | null;
      metadata?: unknown;
    } | null;
    photoPath: string | null;
    photoPosition: {
      offset?: { x?: number; y?: number };
      zoom?: number;
      aspect?: string;
    } | null;
  }> = (
    lendsRes.data ?? []
  ).map(
    (item: {
      id: string;
      title: string | null;
      description: string | null;
      price_points: number | null;
      status: string | null;
      photos?: unknown | null;
      item_custom_brand_label?: string | null;
      item_brands?: { label?: string | null } | null;
      item_intake?:
        | {
            listing_stage?: string;
            fulfillment_stage?: string | null;
            updated_at?: string | null;
            metadata?: unknown;
          }
        | {
            listing_stage?: string;
            fulfillment_stage?: string | null;
            updated_at?: string | null;
            metadata?: unknown;
          }[]
        | null;
    }) => {
    const photoData = resolveItemPhotoData(item.photos ?? null);
    const brand =
      (typeof item.item_custom_brand_label === "string" && item.item_custom_brand_label.trim()) ||
      item.item_brands?.label?.trim() ||
      null;
    const rawIntake = item.item_intake;
      const intakeRow = Array.isArray(rawIntake)
        ? [...rawIntake]
            .filter((row) => row && typeof row === "object")
            .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0]
        : rawIntake;
    const intake =
      intakeRow && typeof intakeRow === "object"
        ? {
            listing_stage: String(intakeRow.listing_stage ?? ""),
            fulfillment_stage:
              intakeRow.fulfillment_stage != null ? String(intakeRow.fulfillment_stage) : null,
            metadata: "metadata" in intakeRow ? (intakeRow as { metadata?: unknown }).metadata : undefined,
          }
        : null;
    return {
      id: item.id,
      name: item.title?.trim() || "Piece sans titre",
      description: item.description?.trim() || null,
      brand,
      currentValue: item.price_points == null ? null : Number(item.price_points),
      itemStatus: item.status ?? "inconnu",
      intake,
      photoPath: photoData.path,
      photoPosition: photoData.position,
    };
  },
  );

  const signedPhotoByPath = new Map<string, string>();
  const uniquePaths: string[] = Array.from(
    new Set<string>(
      rawLends
        .map((item: { photoPath: string | null }) => item.photoPath)
        .filter((value: string | null): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  );

  const signedLendPhotos = await perf.measure("storage.lendPhotos", () =>
    createSignedUrlsForStoragePaths(supabase, uniquePaths, 60 * 60 * 24),
  );
  for (const path of uniquePaths) {
    const signed = isHttpUrl(path) ? path : signedLendPhotos.get(path);
    if (signed) signedPhotoByPath.set(path, signed);
  }

  const sortedRawLends = [...rawLends].sort((a, b) => {
    const pa = lendPipelineRank(a.itemStatus, a.intake);
    const pb = lendPipelineRank(b.itemStatus, b.intake);
    if (pa !== pb) return pa - pb;
    const ca = effectiveCatalogSortRank(a.itemStatus, a.intake);
    const cb = effectiveCatalogSortRank(b.itemStatus, b.intake);
    if (ca !== cb) return ca - cb;
    return 0;
  });

  const lends: LendItem[] = sortedRawLends.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    brand: item.brand,
    currentValue: item.currentValue,
    itemStatus: item.itemStatus,
    intake: item.intake,
    photoUrl: item.photoPath ? (signedPhotoByPath.get(item.photoPath) ?? null) : null,
    photoPosition: item.photoPosition,
  }));

  const validatedLendsCount = lends.filter((l) => {
    const ls = (l.intake?.listing_stage?.toLowerCase() ?? "") === "validated";
    if (!ls) return false;
    const fs = l.intake?.fulfillment_stage?.toLowerCase() ?? "";
    const st = l.itemStatus.toLowerCase();
    if (fs === "refused" || st === "refused") return false;
    return true;
  }).length;

  const mergedShippingCandidateIds = lends
    .filter((l) => {
      const ls = l.intake?.listing_stage?.toLowerCase() ?? "";
      const fs = l.intake?.fulfillment_stage?.toLowerCase() ?? "";
      return ls === "validated" && (fs === "ready" || fs === "shipping" || fs === "");
    })
    .map((l) => l.id);

  type IntakeBannerSourceRow = {
    item_id: string;
    listing_stage: string | null;
    fulfillment_stage: string | null;
    updated_at: string | null;
    metadata: unknown;
    items:
      | {
          id?: string | null;
          price_points?: number | null;
          status?: string | null;
        }
      | {
          id?: string | null;
          price_points?: number | null;
          status?: string | null;
        }[]
      | null;
  };

  const intakeBannerRows =
    intakeBannersRes.error == null && Array.isArray(intakeBannersRes.data)
      ? (intakeBannersRes.data as IntakeBannerSourceRow[])
      : [];

  type IntakeBannerCandidate = {
    id: string;
    itemStatus: string;
    listingStage: string;
    fulfillmentStage: string | null;
    metadata: unknown;
    updatedAt: string | null;
    pricePoints: number | null;
  };

  const intakeBannerCandidates: IntakeBannerCandidate[] = intakeBannerRows
    .map((row) => {
      const item = Array.isArray(row.items) ? row.items[0] : row.items;
      const listingStage = row.listing_stage ?? "";
      const fulfillmentStage = row.fulfillment_stage ?? null;
      if (!needsItemIntakeUi(listingStage, fulfillmentStage)) return null;
      return {
        id: item?.id ?? row.item_id,
        itemStatus: item?.status ?? "inconnu",
        listingStage,
        fulfillmentStage,
        metadata: row.metadata,
        updatedAt: row.updated_at ?? null,
        pricePoints: item?.price_points == null ? null : Number(item.price_points),
      };
    })
    .filter((x): x is IntakeBannerCandidate => x != null);

  intakeBannerCandidates.sort((a, b) => {
    const pa = lendPipelineRank(a.itemStatus, {
      listing_stage: a.listingStage,
      fulfillment_stage: a.fulfillmentStage,
    });
    const pb = lendPipelineRank(b.itemStatus, {
      listing_stage: b.listingStage,
      fulfillment_stage: b.fulfillmentStage,
    });
    if (pa !== pb) return pa - pb;
    const ca = effectiveCatalogSortRank(a.itemStatus, {
      listing_stage: a.listingStage,
      fulfillment_stage: a.fulfillmentStage,
    });
    const cb = effectiveCatalogSortRank(b.itemStatus, {
      listing_stage: b.listingStage,
      fulfillment_stage: b.fulfillmentStage,
    });
    if (ca !== cb) return ca - cb;
    return 0;
  });

  const defaultShippingGroupIds =
    mergedShippingCandidateIds.length >= 2 ? mergedShippingCandidateIds : [];
  const intakeBannerForStack = dedupeIntakeBannerCandidatesForMergedShipping(
    intakeBannerCandidates,
    defaultShippingGroupIds,
  );

  const exchangeIntakeBannerItems: ExchangeIntakeBannerItem[] = intakeBannerForStack.map((c) => ({
    id: c.id,
    listingStage: c.listingStage,
    fulfillmentStage: c.fulfillmentStage,
    metadata: c.metadata,
    updatedAt: c.updatedAt,
    pricePoints: c.pricePoints,
  }));

  const fmtOrderDate = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

  function formatOrderNumberCompact(cartId: string): string {
    return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
  }

  type CartOrderListRow = { id: string; status: string; created_at?: string | null; updated_at: string };

  const ongoingCartRows = (ongoingRes.data ?? []) as CartOrderListRow[];
  const historyCartRows = (historyRes.data ?? []) as CartOrderListRow[];

  const orderCardCartIds = [...new Set([...ongoingCartRows, ...historyCartRows].map((r) => r.id))];

  const [
    thumbUrlsByCartId,
    outboundShipRes,
    returnShipRes,
    borrowExtensionDaysByCartId,
    borrowReturnDueAtByCartId,
    memberReceiptConfirmedAtByCartId,
  ] = (await Promise.all([
    perf.measure("orders.thumbs", () => fetchSignedFirstPhotoUrlsByCartIds(supabase, orderCardCartIds)),
    orderCardCartIds.length > 0
      ? perf.measure("shipments.outbound", () => supabase
          .from("shipments")
          .select("cart_id,status,updated_at,delivered_at")
          .in("cart_id", orderCardCartIds)
          .eq("context", "cart_outbound")
          .is("deleted_at", null))
      : Promise.resolve({
          data: [] as { cart_id: string; status: string; updated_at: string; delivered_at: string | null }[],
          error: null,
        }),
    orderCardCartIds.length > 0
      ? perf.measure("shipments.return", () => supabase
          .from("shipments")
          .select("cart_id,status,updated_at")
          .in("cart_id", orderCardCartIds)
          .eq("context", "cart_return")
          .is("deleted_at", null))
      : Promise.resolve({ data: [] as { cart_id: string; status: string; updated_at: string }[], error: null }),
    perf.measure("borrow.extensions", () => fetchCartBorrowExtensionDaysByCartIds(supabase, orderCardCartIds)),
    perf.measure("borrow.dueAt", () => fetchCartBorrowReturnDueAtByCartIds(supabase, orderCardCartIds)),
    perf.measure("receipt.confirmed", () =>
      fetchCartMemberReceiptConfirmedAtByCartIds(supabase, orderCardCartIds),
    ),
  ])) as any[];

  const outboundShipmentByCartId = new Map<
    string,
    { status: string; updated_at: string; delivered_at: string | null }
  >();
  if (outboundShipRes.error == null && Array.isArray(outboundShipRes.data)) {
    for (const row of outboundShipRes.data as {
      cart_id: string;
      status: string;
      updated_at: string;
      delivered_at: string | null;
    }[]) {
      const cartId = row.cart_id;
      const prev = outboundShipmentByCartId.get(cartId);
      const anchorMs = Date.parse(resolveOutboundBorrowDeliveredAtIso(row.delivered_at, row.updated_at) ?? "");
      const prevAnchorMs = prev
        ? Date.parse(resolveOutboundBorrowDeliveredAtIso(prev.delivered_at, prev.updated_at) ?? "")
        : Number.NaN;
      if (!prev || (!Number.isNaN(anchorMs) && (Number.isNaN(prevAnchorMs) || anchorMs > prevAnchorMs))) {
        outboundShipmentByCartId.set(cartId, {
          status: row.status,
          updated_at: row.updated_at,
          delivered_at: row.delivered_at,
        });
      }
    }
  }

  for (const row of ongoingCartRows) {
    const ship = outboundShipmentByCartId.get(row.id);
    if (!ship || ship.status.toLowerCase() !== "delivered") continue;
    const confirmedAt = memberReceiptConfirmedAtByCartId.get(row.id) ?? null;
    if (confirmedAt?.trim() || !isMemberReceiptAutoConfirmDue(ship, null, Date.now())) continue;
    const persisted = await ensureMemberReceiptAutoConfirmed(supabase, {
      cartId: row.id,
      userId,
      memberReceiptConfirmedAt: confirmedAt,
      shipment: ship,
    });
    if (persisted) memberReceiptConfirmedAtByCartId.set(row.id, persisted);
  }

  const returnShipmentByCartId = new Map<string, { status: string; updated_at: string }>();
  if (returnShipRes.error == null && Array.isArray(returnShipRes.data)) {
    for (const row of returnShipRes.data as { cart_id: string; status: string; updated_at: string }[]) {
      const cartId = row.cart_id;
      const prev = returnShipmentByCartId.get(cartId);
      if (!prev || new Date(row.updated_at) > new Date(prev.updated_at)) {
        returnShipmentByCartId.set(cartId, { status: row.status, updated_at: row.updated_at });
      }
    }
  }

  function borrowReturnDeadlineMsForShip(
    ship: {
      status: string;
      updated_at: string;
      delivered_at: string | null;
    },
    cartId: string,
  ): number {
    if (String(ship.status).toLowerCase() !== "delivered") return Number.NaN;
    return resolveCartBorrowReturnDueMs({
      borrowReturnDueAtIso: borrowReturnDueAtByCartId.get(cartId) ?? null,
      outboundDeliveredAtIso: ship.delivered_at,
      outboundUpdatedAtIso: ship.updated_at,
      membershipLabel,
      borrowExtensionDaysTotal: borrowExtensionDaysByCartId.get(cartId) ?? 0,
    });
  }

  const exchangeListNowMs = Date.now();

  function buildExchangeOrderCard(
    order: CartOrderListRow,
    thumbs: string[],
    opts: { historyFallback: boolean },
  ) {
    if ((order.status ?? "").toLowerCase() === "canceled") {
      return {
        id: order.id,
        orderNumberCompact: formatOrderNumberCompact(order.id),
        statusLabel: "Commande annulée",
        deliveryLabel: null as string | null,
        itemThumbUrls: thumbs,
      };
    }
    const ret = returnShipmentByCartId.get(order.id);
    if (ret && isReturnExchangeFinishedForMemberList(ret.status)) {
      const phase = getMemberReturnShipmentPhaseCopy(ret.status);
      return {
        id: order.id,
        orderNumberCompact: formatOrderNumberCompact(order.id),
        statusLabel: phase.title,
        deliveryLabel:
          getReturnShipmentSubtitle(ret.status, ret.updated_at, fmtOrderDate) ?? phase.detail,
        itemThumbUrls: thumbs,
        detailHref: `/exchange/retour/${order.id}` as const,
        statusPillTone: "success" as const,
      };
    }
    const ship = outboundShipmentByCartId.get(order.id);
    const returnCommitmentMet = ret != null && isCartReturnCommitmentMet(ret.status);
    const borrowReturnDeadlineMs = ship ? borrowReturnDeadlineMsForShip(ship, order.id) : Number.NaN;
    const borrowReturnUrgentRaw =
      ship != null &&
      Number.isFinite(borrowReturnDeadlineMs) &&
      isBorrowReturnUrgentForExchangeList(exchangeListNowMs, borrowReturnDeadlineMs);
    const borrowReturnVibrateRaw =
      Number.isFinite(borrowReturnDeadlineMs) &&
      isBorrowReturnVibrateForExchangeList(exchangeListNowMs, borrowReturnDeadlineMs);
    const borrowReturnOverdueRaw =
      Number.isFinite(borrowReturnDeadlineMs) &&
      isBorrowReturnOverdueParis(exchangeListNowMs, borrowReturnDeadlineMs);
    const borrowReturnUrgent = borrowReturnUrgentRaw && !returnCommitmentMet;
    const borrowReturnVibrate = borrowReturnVibrateRaw && !returnCommitmentMet;
    const borrowReturnOverdue = borrowReturnOverdueRaw && !returnCommitmentMet;
    const borrowLateDayIndex = borrowReturnOverdue
      ? borrowOverdueLateDayIndex(exchangeListNowMs, borrowReturnDeadlineMs)
      : 0;
    const borrowOverdueSubtitle =
      borrowReturnOverdue && borrowLateDayIndex >= 1
        ? formatBorrowOverdueDaysLabelFr(borrowLateDayIndex)
        : null;
    const forceReturnNow = (() => {
      if (!ret || !ship || returnCommitmentMet) return false;
      if (!Number.isFinite(borrowReturnDeadlineMs)) return false;
      return isBorrowReturnAlertPhaseParis(exchangeListNowMs, borrowReturnDeadlineMs);
    })();
    if (ret && !isReturnShipmentPreDeposit(ret.status) && (forceReturnNow || borrowReturnUrgent)) {
      const phase = getMemberReturnShipmentPhaseCopy(ret.status);
      const deliveryLabel = borrowOverdueSubtitle ?? getReturnShipmentSubtitle(ret.status, ret.updated_at, fmtOrderDate);
      return {
        id: order.id,
        orderNumberCompact: formatOrderNumberCompact(order.id),
        statusLabel: borrowReturnOverdue ? "Retard" : phase.title,
        deliveryLabel,
        itemThumbUrls: thumbs,
        detailHref: `/exchange/retour/${order.id}` as const,
        ...(phase.pulse ? { showPulse: true as const } : {}),
        ...(borrowReturnUrgent ? { statusPillTone: "return" as const } : {}),
        ...(borrowReturnVibrate ? { showReturnVibrate: true as const } : {}),
      };
    }

    if (!ship) {
      return {
        id: order.id,
        orderNumberCompact: formatOrderNumberCompact(order.id),
        statusLabel: opts.historyFallback ? "Commande archivée" : "Suivi non disponible",
        deliveryLabel: null as string | null,
        itemThumbUrls: thumbs,
      };
    }
    const phase = getMemberOutboundShipmentPhaseCopy(ship.status);
    const st = ship.status.toLowerCase();
    const receiptConfirmedAt = memberReceiptConfirmedAtByCartId.get(order.id) ?? null;
    const exchangeReceiptValidated = isMemberReceiptValidated(
      receiptConfirmedAt,
      ship,
      exchangeListNowMs,
    );
    const deliveryLabel = getOutboundShipmentDeliverySubtitle(
      ship.status,
      resolveOutboundBorrowDeliveredAtIso(ship.delivered_at, ship.updated_at) ?? ship.updated_at,
      fmtOrderDate,
      Number.isFinite(borrowReturnDeadlineMs) ? { borrowReturnDueMs: borrowReturnDeadlineMs } : undefined,
    );
    const detailHref =
      st === "delivered"
        ? exchangeReceiptValidated
          ? (`/exchange/emprunt/${order.id}` as const)
          : (`/commande/${order.id}` as const)
        : undefined;
    const deliveredBorrowUrgent = st === "delivered" && borrowReturnUrgent;
    return {
      id: order.id,
      orderNumberCompact: formatOrderNumberCompact(order.id),
      statusLabel: borrowReturnOverdue ? "Retard" : deliveredBorrowUrgent ? "Retour" : phase.title,
      deliveryLabel: borrowOverdueSubtitle ?? deliveryLabel,
      itemThumbUrls: thumbs,
      ...(detailHref ? { detailHref } : {}),
      ...(phase.pulse ? { showPulse: true as const } : {}),
      ...(deliveredBorrowUrgent
        ? { statusPillTone: "return" as const }
        : st === "delivered"
          ? { statusPillTone: "success" as const }
          : {}),
      ...(borrowReturnVibrate ? { showReturnVibrate: true as const } : {}),
    };
  }

  function exchangeOngoingOrderSortKey(orderId: string): { urgent: 0 | 1; deadlineMs: number } {
    const ship = outboundShipmentByCartId.get(orderId);
    if (!ship) return { urgent: 1, deadlineMs: Number.POSITIVE_INFINITY };
    const deadlineMs = borrowReturnDeadlineMsForShip(ship, orderId);
    const urgent =
      Number.isFinite(deadlineMs) && isBorrowReturnUrgentForExchangeList(exchangeListNowMs, deadlineMs) ? 0 : 1;
    return { urgent, deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : Number.POSITIVE_INFINITY };
  }

  function isOngoingExchangeCartRow(cartId: string): boolean {
    const ret = returnShipmentByCartId.get(cartId);
    return !ret || !isReturnExchangeFinishedForMemberList(ret.status);
  }

  const ongoingCartRowsForList = ongoingCartRows.filter((row) => isOngoingExchangeCartRow(row.id));
  const finishedExchangeHistoryRows = ongoingCartRows.filter((row) => !isOngoingExchangeCartRow(row.id));

  /** Pastille + sous-texte livraison : uniquement depuis l’expédition aller (`shipments`), pas le statut panier. */
  const ongoingOrders = [...ongoingCartRowsForList]
    .sort((a, b) => {
      const ka = exchangeOngoingOrderSortKey(a.id);
      const kb = exchangeOngoingOrderSortKey(b.id);
      if (ka.urgent !== kb.urgent) return ka.urgent - kb.urgent;
      if (ka.urgent === 0 && ka.deadlineMs !== kb.deadlineMs) return ka.deadlineMs - kb.deadlineMs;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })
    .map((order) => buildExchangeOrderCard(order, thumbUrlsByCartId.get(order.id) ?? [], { historyFallback: false }));

  const recentOrders = [...finishedExchangeHistoryRows, ...historyCartRows]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((order) => buildExchangeOrderCard(order, thumbUrlsByCartId.get(order.id) ?? [], { historyFallback: true }));

  const hasReachedLendingCap =
    (membershipLabel === "Membre +" || membershipLabel === "Membre X") &&
    includedLendsLimit > 0 &&
    validatedLendsCount >= includedLendsLimit;

  const memberSubscriber = membershipLabel === "Membre +" || membershipLabel === "Membre X";

  const echangeSectionOrder = await perf.measure("cms.exchange.order", () => fetchEchangeSectionOrder(supabase));
  const cmsKeysToResolve = [...new Set(echangeSectionOrder.filter((k) => !EXCHANGE_NATIVE_SECTION_KEYS.has(k)))];
  const cmsSectionsByKey: Record<string, { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay }> = {};
  await Promise.all(
    cmsKeysToResolve.map(async (sectionKey) => {
      const [frames, display] = await Promise.all([
        perf.measure(`cms.${sectionKey}.frames`, () => fetchCmsSectionFramesResolved(supabase, sectionKey)),
        perf.measure(`cms.${sectionKey}.display`, () => fetchCmsSectionPublishedDisplay(supabase, sectionKey)),
      ]);
      cmsSectionsByKey[sectionKey] = { frames, display };
    }),
  );

  const [emptyCartFrames, emptyCartDisplay, emptyLendsFrames, emptyLendsDisplay] = await Promise.all([
    perf.measure("cms.emptyCart.frames", () => fetchCmsSectionFramesResolved(supabase, EXCHANGE_CART_EMPTY_CMS_SECTION_KEY)),
    perf.measure("cms.emptyCart.display", () => fetchCmsSectionPublishedDisplay(supabase, EXCHANGE_CART_EMPTY_CMS_SECTION_KEY)),
    perf.measure("cms.emptyLends.frames", () => fetchCmsSectionFramesResolved(supabase, EXCHANGE_LENDS_EMPTY_CMS_SECTION_KEY)),
    perf.measure("cms.emptyLends.display", () => fetchCmsSectionPublishedDisplay(supabase, EXCHANGE_LENDS_EMPTY_CMS_SECTION_KEY)),
  ]);
  const emptyCartCms: { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay } = {
    frames: emptyCartFrames,
    display: emptyCartDisplay,
  };
  const emptyLendsCms: { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay } = {
    frames: emptyLendsFrames,
    display: emptyLendsDisplay,
  };
  const emptyCartItemIds = collectCmsShopItemIdsFromFrameRows(emptyCartFrames);
  const emptyLendsItemIds = collectCmsShopItemIdsFromFrameRows(emptyLendsFrames);
  const [emptyCartCmsCatalogItems, emptyLendsCmsCatalogItems] = await Promise.all([
    emptyCartItemIds.length > 0 ? perf.measure("cms.emptyCart.items", () => fetchShopCatalogItemsByIds(supabase, emptyCartItemIds)) : Promise.resolve([]),
    emptyLendsItemIds.length > 0 ? perf.measure("cms.emptyLends.items", () => fetchShopCatalogItemsByIds(supabase, emptyLendsItemIds)) : Promise.resolve([]),
  ]);

  const outboundShipmentSummary = await perf.measure("shipments.outboundSummary", () =>
    fetchLatestConfirmedCartOutboundShipmentSummary(supabase, userId),
  );
  const showOutboundCallout =
    outboundShipmentSummary != null && outboundShipmentSummary.status.toLowerCase() !== "closed";

  const uberRelayFallbackFromShipment =
    outboundShipmentSummary != null &&
    outboundShipmentSummary.uberOutboundFailed &&
    checkoutMetaIndicatesUberDirect(
      outboundShipmentSummary.checkoutDeliveryChannel,
      outboundShipmentSummary.checkoutHomeSpeed,
    );
  const uberRelayFallback = uberRelayFallbackFromShipment;

  const exchangeOnboardingRow = await perf.measure("users.appState", () => getCurrentUserAppState(userId));
  const showProfileInAppOnboarding = exchangeOnboardingRow.onboarding_process === "profile";
  const showKycInAppOnboarding = exchangeOnboardingRow.onboarding_process === "kyc";
  const showCartInAppOnboarding = exchangeOnboardingRow.onboarding_process === "panier";
  const showOfferInAppOnboarding = exchangeOnboardingRow.onboarding_process === "offer";
  const showExchangeInAppOnboarding = exchangeOnboardingRow.onboarding_process === "exchange";
  await perf.measure("borrowOverdue.sync", async () => {
    try {
      const admin = createSupabaseAdminClient();
      await syncMemberBorrowOverdueAccrual(admin, userId);
    } catch (e) {
      console.error("[exchange] borrow overdue sync", e);
    }
  });
  const [borrowReturnOverdueAlerts, borrowReturnJjAlerts, piggybackDepositQueue] = await Promise.all([
    perf.measure("borrowReturnOverdueAlerts", () => fetchMemberBorrowReturnOverdueAlerts(supabase, userId)),
    perf.measure("borrowReturnJjAlerts", () => fetchMemberBorrowReturnJjAlerts(supabase, userId)),
    perf.measure("piggyback.depositQueue", async () => {
      try {
        const admin = createSupabaseAdminClient();
        return fetchMemberPiggybackDepositConfirmQueue(admin, userId);
      } catch {
        return [];
      }
    }),
  ]);
  const eagerLendDetailPrefetchIds = lends
    .filter((l) => {
      const st = l.itemStatus.toLowerCase();
      const ls = l.intake?.listing_stage?.toLowerCase() ?? "";
      const fs = l.intake?.fulfillment_stage?.toLowerCase() ?? "";
      if (st === "refused" || st === "draft_deleted") return false;
      if (ls === "evaluation" || ls === "evaluated" || ls === "validation_pending" || ls === "refused") return false;
      if (ls === "validated" && fs !== "verified") return false;
      return true;
    })
    .slice(0, 2)
    .map((l) => l.id);
  perf.log({
    lends: lends.length,
    cartLines: cartLines.length,
    orders: orderCardCartIds.length,
    cmsSections: cmsKeysToResolve.length,
  });

  return (
    <>
      <ExchangeLendsDetailPrefetch itemIds={eagerLendDetailPrefetchIds} />
      {piggybackDepositQueue.length > 0 ? (
        <ExchangePiggybackDepositConfirmModal initialQueue={piggybackDepositQueue} />
      ) : null}
      <div className="sticky top-0 z-30 bg-white">
        <ExchangeHeader
          membershipLabel={membershipLabel}
          availablePoints={availablePoints}
          balanceConsumptionPoints={walletPoints.consumption}
          balanceExchangePoints={walletPoints.exchange}
          activeCartCostPoints={activeCartCostPoints}
          hasReachedLendingCap={hasReachedLendingCap}
          guideOfferOnboarding={showOfferInAppOnboarding}
        />
        {borrowReturnOverdueAlerts.length > 0 ? (
          <div className="px-5 pb-2">
            <div className="mx-auto w-full max-w-[460px]">
              <BorrowReturnOverdueBanner alerts={borrowReturnOverdueAlerts} />
            </div>
          </div>
        ) : null}
        {borrowReturnOverdueAlerts.length === 0 && borrowReturnJjAlerts.length > 0 ? (
          <div className="px-5 pb-2">
            <div className="mx-auto w-full max-w-[460px]">
              <BorrowReturnJjDayBanner alerts={borrowReturnJjAlerts} />
            </div>
          </div>
        ) : null}
        <ExchangeHeaderAlertStack
          intakeItems={exchangeIntakeBannerItems}
          defaultShippingGroupIds={defaultShippingGroupIds}
          outboundSummary={showOutboundCallout && outboundShipmentSummary ? outboundShipmentSummary : null}
          showProfileOnboarding={showProfileInAppOnboarding}
          showKycOnboarding={showKycInAppOnboarding}
          showCartOnboarding={showCartInAppOnboarding}
          showExchangeOnboarding={showExchangeInAppOnboarding}
          uberRelayFallback={uberRelayFallback}
        />
      </div>

      <MainContent className="flex flex-col space-y-0 bg-zinc-100 px-0 pb-0 pt-0">
        <div className="space-y-[4.5px]">
          {echangeSectionOrder.map((sectionKey) => {
            switch (sectionKey) {
              case "commerce_promo_ad":
                if (memberSubscriber) return null;
                /* Invités : pas de rail promo « premium » (le prêt catalogue ne dépend plus d’un abonnement). */
                if (membershipLabel === "Guest") return null;
                return (
                  <ExchangeCommercePromo
                    key={sectionKey}
                    rows={cmsSectionsByKey[sectionKey]?.frames ?? []}
                  />
                );
              case "exchange_system_cart":
                return (
                  <ExchangeCartSection
                    key={sectionKey}
                    initialLines={cartLines}
                    activeCartId={activeCartId}
                    membershipLabel={membershipLabel}
                    availablePoints={availablePoints}
                    emptyCartCms={emptyCartCms}
                    emptyCartCmsCatalogItems={emptyCartCmsCatalogItems}
                    guideCartOnboarding={showCartInAppOnboarding}
                  />
                );
              case "exchange_system_lends":
                return (
                  <ExchangeLendsSection
                    key={sectionKey}
                    lends={lends}
                    membershipLabel={membershipLabel}
                    includedLendsLimit={includedLendsLimit}
                    validatedLendsCount={validatedLendsCount}
                    mergedShippingCandidateIds={mergedShippingCandidateIds}
                    promoAdRows={
                      memberSubscriber ? (cmsSectionsByKey.commerce_promo_ad?.frames ?? []) : []
                    }
                    emptyLendsCms={emptyLendsCms}
                    emptyLendsCmsCatalogItems={emptyLendsCmsCatalogItems}
                    guideExchangeOnboarding={showExchangeInAppOnboarding}
                  />
                );
              case "exchange_system_history":
                return (
                  <ExchangeInteractionsSection
                    key={sectionKey}
                    ongoingOrders={ongoingOrders}
                    recentOrders={recentOrders}
                  />
                );
              default: {
                const cms = cmsSectionsByKey[sectionKey];
                if (!cms) return null;
                if (
                  membershipLabel === "Guest" &&
                  lends.length > 0 &&
                  isExchangeGuestRedundantPretsModularSection(sectionKey, cms.display)
                ) {
                  return null;
                }
                return (
                  <ExchangeDynamicCmsSection
                    key={sectionKey}
                    sectionKey={sectionKey}
                    cms={cms}
                    guideOfferOnboarding={showOfferInAppOnboarding}
                  />
                );
              }
            }
          })}
        </div>
        <ExchangeEmptyFill />
      </MainContent>
    </>
  );
}
