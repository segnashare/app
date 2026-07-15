import { parseUserWalletPointsRow, type UserWalletPointsRow } from "@/lib/wallet/user-wallet-row";

export type WalletOverviewBorrowRow = {
  cartId: string;
  orderNumberCompact: string;
  debitedPoints: number;
  returnedPoints: number;
  recoverablePoints: number;
};

export type WalletOverviewPendingLendRow = {
  itemId: string;
  title: string;
  points: number;
};

export type WalletOverview = {
  available: {
    total: number;
    consumption: number;
    exchange: number;
  };
  incoming: {
    total: number;
    borrowReturnCredits: number;
    lendPayoutCredits: number;
  };
  projectedTotal: number;
  activeBorrows: WalletOverviewBorrowRow[];
  pendingLendPayouts: WalletOverviewPendingLendRow[];
};

type WalletTxRow = {
  amount_points: number | null;
  direction: string | null;
  credit_bucket: string | null;
  metadata: Record<string, unknown> | null;
};

function readMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = meta?.[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function formatOrderNumberCompact(cartId: string): string {
  return cartId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function walletTxPoints(row: WalletTxRow): number {
  const meta = row.metadata ?? {};
  const splitRaw = meta.debit_split;
  if (splitRaw && typeof splitRaw === "object" && !Array.isArray(splitRaw)) {
    const s = splitRaw as Record<string, unknown>;
    return (
      Math.max(0, Math.floor(Number(s.exchange_points ?? 0))) +
      Math.max(0, Math.floor(Number(s.consumption_points ?? 0)))
    );
  }
  return Math.max(0, Math.floor(Number(row.amount_points ?? 0)));
}

function sumCartWalletPoints(
  rows: WalletTxRow[],
  cartId: string,
  sourceMatcher: (source: string) => boolean,
): number {
  let total = 0;
  for (const row of rows) {
    const meta = row.metadata ?? {};
    const source = readMetaString(meta, "source")?.toLowerCase() ?? "";
    const rowCartId = readMetaString(meta, "cart_id");
    if (rowCartId !== cartId || !sourceMatcher(source)) continue;
    total += walletTxPoints(row);
  }
  return total;
}

function collectCreditedLendItemIds(rows: WalletTxRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const meta = row.metadata ?? {};
    const source = readMetaString(meta, "source")?.toLowerCase() ?? "";
    if (source !== "lend_intake_verified") continue;
    const itemId = readMetaString(meta, "item_id");
    if (itemId) ids.add(itemId);
  }
  return ids;
}

/** Prêt en file vérification Segna : crédits versés uniquement après passage BO → verified. */
function isPendingLendPayout(
  listingStage: string,
  fulfillmentStage: string,
  itemId: string,
  creditedItemIds: Set<string>,
): boolean {
  if (creditedItemIds.has(itemId)) return false;
  if (listingStage !== "validated") return false;
  return fulfillmentStage === "in_verification";
}

export async function fetchWalletOverview(supabaseInput: unknown, userId: string): Promise<WalletOverview> {
  const supabase = supabaseInput as any;

  const [walletRes, cartsRes, walletTxRes, lendPayoutTxRes, lendsRes] = await Promise.all([
    supabase
      .from("user_wallets")
      .select("balance_points, balance_consumption_points, balance_exchange_points")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("wallet_transactions")
      .select("amount_points, direction, credit_bucket, metadata")
      .eq("user_id", userId)
      .or("metadata->>source.eq.cart_order_stripe,metadata->>source.eq.return_verification_ok"),
    supabase
      .from("wallet_transactions")
      .select("metadata")
      .eq("user_id", userId)
      .eq("direction", "credit")
      .filter("metadata->>source", "eq", "lend_intake_verified"),
    supabase
      .from("items")
      .select("id,title,price_points, item_intake(listing_stage, fulfillment_stage, updated_at)")
      .eq("owner_user_id", userId)
      .is("deleted_at", null)
      .in("status", ["draft", "available", "reserved", "sold", "in_cart"])
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  if (walletRes.error) throw new Error(walletRes.error.message);
  if (cartsRes.error) throw new Error(cartsRes.error.message);
  if (walletTxRes.error) throw new Error(walletTxRes.error.message);
  if (lendPayoutTxRes.error) throw new Error(lendPayoutTxRes.error.message);
  if (lendsRes.error) throw new Error(lendsRes.error.message);

  const available = parseUserWalletPointsRow(walletRes.data as Partial<UserWalletPointsRow> | null);
  const walletTxRows = (walletTxRes.data ?? []) as WalletTxRow[];
  const creditedLendItemIds = collectCreditedLendItemIds((lendPayoutTxRes.data ?? []) as WalletTxRow[]);

  const activeBorrows: WalletOverviewBorrowRow[] = [];
  let borrowReturnCredits = 0;

  for (const cart of (cartsRes.data ?? []) as { id?: string }[]) {
    const cartId = typeof cart.id === "string" ? cart.id : "";
    if (!cartId) continue;

    const debitedPoints = sumCartWalletPoints(
      walletTxRows.filter((row) => row.direction === "debit"),
      cartId,
      (source) => source === "cart_order_stripe",
    );
    const returnedPoints = sumCartWalletPoints(
      walletTxRows.filter((row) => row.direction === "credit"),
      cartId,
      (source) => source === "return_verification_ok",
    );
    const recoverablePoints = Math.max(0, debitedPoints - returnedPoints);
    if (recoverablePoints <= 0) continue;

    borrowReturnCredits += recoverablePoints;
    activeBorrows.push({
      cartId,
      orderNumberCompact: formatOrderNumberCompact(cartId),
      debitedPoints,
      returnedPoints,
      recoverablePoints,
    });
  }

  const pendingLendPayouts: WalletOverviewPendingLendRow[] = [];
  let lendPayoutCredits = 0;

  for (const item of (lendsRes.data ?? []) as {
    id?: string;
    title?: string | null;
    price_points?: number | null;
    item_intake?:
      | { listing_stage?: string | null; fulfillment_stage?: string | null; updated_at?: string | null }
      | { listing_stage?: string | null; fulfillment_stage?: string | null; updated_at?: string | null }[]
      | null;
  }[]) {
    const itemId = typeof item.id === "string" ? item.id : "";
    if (!itemId) continue;

    const rawIntake = item.item_intake;
    const intakeRow = Array.isArray(rawIntake)
      ? [...rawIntake]
          .filter((row) => row && typeof row === "object")
          .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0]
      : rawIntake;
    const listingStage = (intakeRow?.listing_stage ?? "").trim().toLowerCase();
    const fulfillmentStage = (intakeRow?.fulfillment_stage ?? "").trim().toLowerCase();
    const points = Math.max(0, Math.floor(Number(item.price_points ?? 0)));
    if (points <= 0) continue;

    if (!isPendingLendPayout(listingStage, fulfillmentStage, itemId, creditedLendItemIds)) continue;

    lendPayoutCredits += points;
    pendingLendPayouts.push({
      itemId,
      title: item.title?.trim() || "Pièce sans titre",
      points,
    });
  }

  const incomingTotal = borrowReturnCredits + lendPayoutCredits;

  return {
    available: {
      total: available.total,
      consumption: available.consumption,
      exchange: available.exchange,
    },
    incoming: {
      total: incomingTotal,
      borrowReturnCredits,
      lendPayoutCredits,
    },
    projectedTotal: available.total + incomingTotal,
    activeBorrows,
    pendingLendPayouts,
  };
}
