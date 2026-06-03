import { NextResponse } from "next/server";

import { walletTransactionDisplayLabel, type WalletRecentTransaction } from "@/lib/wallet/wallet-transaction-display";
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

    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("id, created_at, direction, amount_points, metadata, idempotency_key")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    const transactions: WalletRecentTransaction[] = (data ?? []).map((row: Record<string, unknown>) => {
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
      };
    });

    return NextResponse.json({ transactions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de charger le wallet.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
