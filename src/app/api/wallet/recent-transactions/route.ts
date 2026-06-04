import { NextResponse } from "next/server";

import { pickLatestWalletTransactionAnnouncement } from "@/lib/wallet/wallet-transaction-announcement";
import {
  attachWalletTransactionBalances,
  isHiddenWalletTransactionRow,
  mergeCartBorrowWalletDisplayRows,
  walletTransactionDisplayLabel,
  type WalletRecentTransaction,
} from "@/lib/wallet/wallet-transaction-display";
import { parseUserWalletPointsRow } from "@/lib/wallet/user-wallet-row";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = (await createSupabaseServerClient()) as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const [{ data, error }, { data: walletRow, error: walletError }] = await Promise.all([
      supabase
        .from("wallet_transactions")
        .select("id, created_at, direction, amount_points, metadata, idempotency_key, credit_bucket")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("user_wallets")
        .select("balance_points, balance_consumption_points, balance_exchange_points")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }
    if (walletError) {
      return NextResponse.json({ message: walletError.message }, { status: 500 });
    }

    const currentBalancePoints = parseUserWalletPointsRow(
      walletRow as Record<string, unknown> | null,
    ).total;

    const baseTransactions = (data ?? [])
      .filter((row: Record<string, unknown>) => {
        const idempotencyKey = typeof row.idempotency_key === "string" ? row.idempotency_key : null;
        return !isHiddenWalletTransactionRow(idempotencyKey);
      })
      .map((row: Record<string, unknown>) => {
      const meta = (row.metadata as Record<string, unknown> | null) ?? null;
      const idempotencyKey = typeof row.idempotency_key === "string" ? row.idempotency_key : null;
      const { label, subtitle, isAdminAdjustment } = walletTransactionDisplayLabel(meta, idempotencyKey);
      const direction = row.direction === "credit" ? "credit" : "debit";
      const createdAt = String(row.created_at ?? "");
      return {
        id: String(row.id),
        createdAt,
        direction,
        amountPoints: Math.max(0, Math.trunc(Number(row.amount_points ?? 0))),
        label,
        subtitle,
        isAdminAdjustment,
        idempotency_key: idempotencyKey,
        metadata: meta,
        credit_bucket: typeof row.credit_bucket === "string" ? row.credit_bucket : null,
      };
    });

    const mergedTransactions = mergeCartBorrowWalletDisplayRows(baseTransactions);

    const transactions = attachWalletTransactionBalances(mergedTransactions, currentBalancePoints);
    const latestAnnouncement = pickLatestWalletTransactionAnnouncement(mergedTransactions);

    return NextResponse.json({ transactions, latestAnnouncement });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de charger le wallet.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
