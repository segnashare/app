export type WalletTxSortRow = {
  id: string;
  createdAt: string;
  direction: string;
  amountPoints: number;
  credit_bucket?: string | null;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown> | null;
};

function walletTxEventRank(row: WalletTxSortRow): number {
  const key = (row.idempotency_key ?? "").toLowerCase();
  const source = String(row.metadata?.source ?? "").toLowerCase();

  if (source === "cart_order_cancel" || key.includes("cart_order_cancel_refund")) {
    if (key.includes("_co") || row.credit_bucket === "consumption") return 22;
    return 21;
  }
  if (source === "cart_order_stripe" || key.includes("cart_order_debit")) {
    if (key.includes("_co") || row.credit_bucket === "consumption") return 12;
    return 11;
  }
  return 50;
}

export function compareWalletTransactionsNewestFirst(a: WalletTxSortRow, b: WalletTxSortRow): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (Number.isFinite(ta) && Number.isFinite(tb) && tb !== ta) return tb - ta;

  const rankA = walletTxEventRank(a);
  const rankB = walletTxEventRank(b);
  if (rankB !== rankA) return rankB - rankA;

  const amtA = Math.max(0, Math.trunc(a.amountPoints));
  const amtB = Math.max(0, Math.trunc(b.amountPoints));
  if (a.direction === b.direction && amtB !== amtA) return amtB - amtA;

  const keyA = a.idempotency_key ?? "";
  const keyB = b.idempotency_key ?? "";
  if (keyB !== keyA) return keyB.localeCompare(keyA);

  return b.id.localeCompare(a.id);
}

export function sortWalletTransactionsNewestFirst<T extends WalletTxSortRow>(rows: T[]): T[] {
  return [...rows].sort(compareWalletTransactionsNewestFirst);
}
