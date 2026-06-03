import { NextResponse } from "next/server";

import { fetchWalletTransactionDetail } from "@/lib/wallet/fetch-wallet-transaction-detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ transactionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { transactionId } = await context.params;
    if (!transactionId?.trim()) {
      return NextResponse.json({ message: "Transaction introuvable." }, { status: 400 });
    }

    const supabase = (await createSupabaseServerClient()) as never;
    const {
      data: { user },
      error: userError,
    } = await (supabase as any).auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const detail = await fetchWalletTransactionDetail(supabase, user.id, transactionId.trim());
    if (!detail) {
      return NextResponse.json({ message: "Transaction introuvable." }, { status: 404 });
    }

    return NextResponse.json({ detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de charger la transaction.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
