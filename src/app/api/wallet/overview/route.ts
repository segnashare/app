import { NextResponse } from "next/server";

import { fetchWalletOverview } from "@/lib/wallet/fetch-wallet-overview";
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

    const overview = await fetchWalletOverview(supabase, user.id);
    return NextResponse.json({ overview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de charger le wallet.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
