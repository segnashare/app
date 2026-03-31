import { ExchangeCartSection, type CartLine, type CartLineStatus } from "@/components/exchange/ExchangeCartSection";
import { ExchangeEmptyFill } from "@/components/exchange/ExchangeEmptyFill";
import { ExchangeHeader } from "@/components/exchange/ExchangeHeader";
import { ExchangeInteractionsSection } from "@/components/exchange/ExchangeInteractionsSection";
import { ExchangeLendsDetailPrefetch } from "@/components/exchange/ExchangeLendsDetailPrefetch";
import { ExchangeLendsSection, type LendItem } from "@/components/exchange/ExchangeLendsSection";
import { MainContent } from "@/components/layout/MainContent";
import { sortCartLinesByPriceAsc } from "@/lib/cart/sort-cart-lines-by-price";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSignedUrlForStoragePath } from "@/lib/supabase/storage-resolve-signed-url";

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

function mapCartLineStatus(cartItemStatus: string | null, itemStatus: string | null): CartLineStatus {
  if (cartItemStatus === "reserved" && itemStatus === "reserved") return "reserve";
  if (cartItemStatus === "reservation_pending" && (itemStatus === "available" || itemStatus === "listed")) {
    return "en_attente_wallet";
  }
  if (cartItemStatus === "in_cart" && (itemStatus === "available" || itemStatus === "in_cart")) return "disponible";
  return "echec";
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

export default async function ExchangePage() {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const userId = user.id as string;
  const nowIso = new Date().toISOString();

  const [membershipStateRes, subscriptionRowRes, rolesRes, walletRes, holdsRes, activeCartRes, lendsRes, disputesRes, historyRes, historyCountRes] = await Promise.all([
    supabase.rpc("get_current_membership_state"),
    supabase
      .from("user_subscriptions")
      .select("plan_code,status")
      .eq("user_id", userId)
      .eq("provider", "stripe")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("user_wallets").select("balance_points").eq("user_id", userId).is("deleted_at", null).maybeSingle(),
    supabase.from("wallet_holds").select("amount_points").eq("user_id", userId).eq("status", "active").gt("expires_at", nowIso),
    supabase
      .from("carts")
      .select("id,status,updated_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", ["active", "reserved"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("items")
      .select(
        "id,title,description,price_points,status,photos,item_brand_id,item_brands(label), item_intake(listing_stage, fulfillment_stage, updated_at, metadata)",
      )
      .eq("owner_user_id", userId)
      .is("deleted_at", null)
      .in("status", ["draft", "listed", "available", "in_cart", "reserved", "refused", "retired"])
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase.from("cart_disputes").select("id", { count: "exact", head: true }).eq("opened_by_user_id", userId).is("deleted_at", null),
    supabase.from("carts").select("id,status,updated_at").eq("user_id", userId).is("deleted_at", null).neq("status", "active").order("updated_at", { ascending: false }).limit(3),
    supabase.from("carts").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null).neq("status", "active"),
  ]);

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
  /** Même ordre que le profil : table Stripe d’abord (source de vérité), puis RPC (plafonds / mois), puis rôles. */
  const membershipLabel =
    membershipLabelFromSubscriptionTable !== "Guest"
      ? membershipLabelFromSubscriptionTable
      : membershipLabelFromRpc !== "Guest"
        ? membershipLabelFromRpc
        : toMembershipLabel(roles);
  const includedLendsLimitFromRpc = parseIncludedLendsLimitRpc(membershipStateRes.data);
  const includedLendsLimit = resolveIncludedLendsLimit(membershipLabel, includedLendsLimitFromRpc);

  const totalPoints = Number(walletRes.data?.balance_points ?? 0);
  const blockedPoints = (holdsRes.data ?? []).reduce((sum: number, hold: { amount_points?: number | null }) => sum + Number(hold.amount_points ?? 0), 0);
  const availablePoints = Math.max(0, totalPoints - blockedPoints);

  const activeCart = activeCartRes.data;
  let cartLines: CartLine[] = [];
  let activeCartCostPoints: number | null = null;
  let cartStatusLabel = "Aucun panier actif";

  if (activeCart?.id) {
    const [cartItemsRes, itemRowsRes] = await Promise.all([
      supabase.from("cart_items").select("id,item_id,status").eq("cart_id", activeCart.id).is("deleted_at", null).order("created_at", { ascending: true }),
      supabase.from("cart_items").select("item_id").eq("cart_id", activeCart.id).is("deleted_at", null),
    ]);

    const itemIds = (itemRowsRes.data ?? []).map((row: { item_id?: string | null }) => row.item_id).filter(Boolean);
    let itemsMap = new Map<string, { title: string | null; price_points: number | null; status: string | null }>();

    if (itemIds.length > 0) {
      const itemsRes = await supabase.from("items").select("id,title,price_points,status").in("id", itemIds);
      itemsMap = new Map(
        (itemsRes.data ?? []).map((item: { id: string; title: string | null; price_points: number | null; status: string | null }) => [
          item.id,
          { title: item.title, price_points: item.price_points, status: item.status },
        ]),
      );
    }

    cartLines = sortCartLinesByPriceAsc(
      (cartItemsRes.data ?? []).map((line: { id: string; item_id: string; status: string | null }) => {
        const item = itemsMap.get(line.item_id);
        const pricePoints = Number(item?.price_points ?? 0);
        return {
          id: line.id,
          itemId: line.item_id ?? null,
          itemName: item?.title?.trim() || "Piece sans titre",
          pricePoints,
          status: mapCartLineStatus(line.status, item?.status ?? null),
        };
      }),
    );
    activeCartCostPoints = cartLines.reduce((sum, line) => sum + line.pricePoints, 0);
    cartStatusLabel = activeCart.status === "reserved" ? "Reserve (10 min)" : "Actif";
  }

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
    const brand = item.item_brands?.label?.trim() || null;
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

  await Promise.all(
    uniquePaths.map(async (path: string) => {
      if (isHttpUrl(path)) {
        signedPhotoByPath.set(path, path);
        return;
      }

      const signed = await createSignedUrlForStoragePath(supabase, path, 60 * 60 * 24);
      if (signed) signedPhotoByPath.set(path, signed);
    }),
  );

  const statusSortOrder: Record<string, number> = {
    available: 0,
    in_cart: 0,
    listed: 1,
    draft: 3,
    reserved: 3,
  };

  /** Plus la valeur est basse, plus l’étape pipeline est avancée (affichage en premier). */
  function lendPipelineRank(item: (typeof rawLends)[0]): number {
    const st = item.itemStatus.toLowerCase();
    const ls = item.intake?.listing_stage?.toLowerCase() ?? "";
    const fs = item.intake?.fulfillment_stage?.toLowerCase() ?? "";
    if (st === "refused" || fs === "refused") return -1;
    if (ls === "validated") {
      if (fs === "verified") return 0;
      if (fs === "in_verification") return 1;
      // Intake « expédition » : fulfillment shipping ou encore non renseigné.
      if (fs === "shipping" || fs === "") return 2;
    }
    if (ls === "validation_pending") return 3;
    if (ls === "evaluated") return 4;
    if (ls === "evaluation") return 5;
    return 6;
  }

  /** verified = disponible au catalogue : même rang de tri que `available`, pas `listed`. */
  function effectiveCatalogSortRank(itemStatus: string, intake: (typeof rawLends)[0]["intake"]): number {
    const key = itemStatus.toLowerCase();
    const fs = intake?.fulfillment_stage?.toLowerCase() ?? "";
    if (key === "refused" || fs === "refused") return -1;
    const ls = intake?.listing_stage?.toLowerCase() ?? "";
    if (ls === "validated" && fs === "verified") return statusSortOrder.available;
    return statusSortOrder[key] ?? 3;
  }

  const sortedRawLends = [...rawLends].sort((a, b) => {
    const pa = lendPipelineRank(a);
    const pb = lendPipelineRank(b);
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
      return ls === "validated" && (fs === "shipping" || fs === "");
    })
    .map((l) => l.id);

  const recentOrders = (historyRes.data ?? []).map((order: { id: string; status: string; updated_at: string }) => ({
    id: order.id,
    status: order.status,
    updatedAt: new Date(order.updated_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }),
  }));

  const hasReachedLendingCap =
    (membershipLabel === "Membre +" || membershipLabel === "Membre X") &&
    includedLendsLimit > 0 &&
    validatedLendsCount >= includedLendsLimit;

  return (
    <>
      <ExchangeLendsDetailPrefetch itemIds={lends.map((l) => l.id)} />
      <div className="sticky top-0 z-30 bg-white">
        <ExchangeHeader
          membershipLabel={membershipLabel}
          availablePoints={availablePoints}
          blockedPoints={blockedPoints}
          totalPoints={totalPoints}
          activeCartCostPoints={activeCartCostPoints}
          hasReachedLendingCap={hasReachedLendingCap}
        />
      </div>

      <MainContent className="flex flex-col space-y-0 bg-zinc-100 px-0 pb-0 pt-0">
        <div className="space-y-[4.5px]">
          <ExchangeCartSection initialLines={cartLines} cartStatusLabel={cartStatusLabel} membershipLabel={membershipLabel} />
          <ExchangeLendsSection
            lends={lends}
            membershipLabel={membershipLabel}
            includedLendsLimit={includedLendsLimit}
            validatedLendsCount={validatedLendsCount}
            mergedShippingCandidateIds={mergedShippingCandidateIds}
          />
          <ExchangeInteractionsSection totalOrders={historyCountRes.count ?? 0} recentOrders={recentOrders} disputesCount={disputesRes.count ?? 0} />
        </div>
        <ExchangeEmptyFill />
      </MainContent>
    </>
  );
}
