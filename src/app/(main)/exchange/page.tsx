import { ExchangeCartSection, type CartLine, type CartLineStatus } from "@/components/exchange/ExchangeCartSection";
import { ExchangeEmptyFill } from "@/components/exchange/ExchangeEmptyFill";
import { ExchangeHeader } from "@/components/exchange/ExchangeHeader";
import { ExchangeInteractionsSection } from "@/components/exchange/ExchangeInteractionsSection";
import { ExchangeLendsSection, type LendItem } from "@/components/exchange/ExchangeLendsSection";
import { MainContent } from "@/components/layout/MainContent";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
};

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

  const [membershipStateRes, rolesRes, walletRes, holdsRes, activeCartRes, lendsRes, disputesRes, historyRes, historyCountRes] = await Promise.all([
    supabase.rpc("get_current_membership_state"),
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
      .select("id,title,description,price_points,status,photos,item_brand_id,item_brands(label)")
      .eq("owner_user_id", userId)
      .is("deleted_at", null)
      .in("status", ["draft", "valuation", "validation_pending", "available", "in_cart", "reserved"])
      .order("updated_at", { ascending: false })
      .limit(6),
    supabase.from("cart_disputes").select("id", { count: "exact", head: true }).eq("opened_by_user_id", userId).is("deleted_at", null),
    supabase.from("carts").select("id,status,updated_at").eq("user_id", userId).is("deleted_at", null).neq("status", "active").order("updated_at", { ascending: false }).limit(3),
    supabase.from("carts").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null).neq("status", "active"),
  ]);

  const roles: string[] = (rolesRes.data ?? []).map((entry: { role?: string | null }) => entry.role ?? "").filter(Boolean);
  const hasBillingState = membershipStateRes.error == null && membershipStateRes.data != null;
  const membershipLabelFromBilling = toMembershipLabelFromBilling((membershipStateRes.data ?? null) as MembershipState | null);
  const membershipLabel = hasBillingState ? membershipLabelFromBilling : toMembershipLabel(roles);

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

    cartLines = (cartItemsRes.data ?? []).map((line: { id: string; item_id: string; status: string | null }) => {
      const item = itemsMap.get(line.item_id);
      const pricePoints = Number(item?.price_points ?? 0);
      return {
        id: line.id,
        itemId: line.item_id ?? null,
        itemName: item?.title?.trim() || "Piece sans titre",
        pricePoints,
        status: mapCartLineStatus(line.status, item?.status ?? null),
      };
    });
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
    photoPath: string | null;
    photoPosition: {
      offset?: { x?: number; y?: number };
      zoom?: number;
      aspect?: string;
    } | null;
  }> = (
    lendsRes.data ?? []
  ).map((item: { id: string; title: string | null; description: string | null; price_points: number | null; status: string | null; photos?: unknown | null; item_brands?: { label?: string | null } | null }) => {
    const photoData = resolveItemPhotoData(item.photos ?? null);
    const brand = item.item_brands?.label?.trim() || null;
    return {
      id: item.id,
      name: item.title?.trim() || "Piece sans titre",
      description: item.description?.trim() || null,
      brand,
      currentValue: item.price_points == null ? null : Number(item.price_points),
      itemStatus: item.status ?? "inconnu",
      photoPath: photoData.path,
      photoPosition: photoData.position,
    };
  });

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

      for (const bucketId of ["bucket_items", "bucket_focus"]) {
        const { data, error } = await supabase.storage.from(bucketId).createSignedUrl(path, 60 * 60 * 24);
        if (!error && data?.signedUrl) {
          signedPhotoByPath.set(path, data.signedUrl);
          return;
        }
      }
    }),
  );

  const statusSortOrder: Record<string, number> = {
    available: 0,
    in_cart: 0,
    validation_pending: 1,
    draft: 2,
    valuation: 2,
    reserved: 2,
  };
  const sortedRawLends = [...rawLends].sort((a, b) => {
    const orderA = statusSortOrder[a.itemStatus] ?? 3;
    const orderB = statusSortOrder[b.itemStatus] ?? 3;
    if (orderA !== orderB) return orderA - orderB;
    return 0;
  });

  const lends: LendItem[] = sortedRawLends.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    brand: item.brand,
    currentValue: item.currentValue,
    itemStatus: item.itemStatus,
    photoUrl: item.photoPath ? (signedPhotoByPath.get(item.photoPath) ?? null) : null,
    photoPosition: item.photoPosition,
  }));

  const recentOrders = (historyRes.data ?? []).map((order: { id: string; status: string; updated_at: string }) => ({
    id: order.id,
    status: order.status,
    updatedAt: new Date(order.updated_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }),
  }));

  const hasReachedLendingCap = membershipLabel === "Membre +" && lends.length >= 5;

  return (
    <>
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
          <ExchangeLendsSection lends={lends} membershipLabel={membershipLabel} />
          <ExchangeInteractionsSection totalOrders={historyCountRes.count ?? 0} recentOrders={recentOrders} disputesCount={disputesRes.count ?? 0} />
        </div>
        <ExchangeEmptyFill />
      </MainContent>
    </>
  );
}
