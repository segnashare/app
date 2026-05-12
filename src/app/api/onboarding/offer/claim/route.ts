import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OFFER_CREDITS_AMOUNT = 50;

export async function POST() {
  try {
    const supabase = (await createSupabaseServerClient()) as any;
    const admin = createSupabaseAdminClient() as any;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ message: "Session invalide." }, { status: 401 });
    }

    const { data: updatedUser, error: userUpdateError } = await admin
      .from("users")
      .update({ onboarding_process: "exchange" })
      .eq("id", user.id)
      .eq("onboarding_process", "offer")
      .select("id")
      .maybeSingle();
    if (userUpdateError) {
      return NextResponse.json({ message: userUpdateError.message }, { status: 500 });
    }

    if (!updatedUser?.id) {
      return NextResponse.json({ ok: true, alreadyClaimed: true, creditsAdded: 0 });
    }

    const { data: walletRow, error: walletReadError } = await admin
      .from("user_wallets")
      .select("id,balance_consumption_points")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (walletReadError) {
      return NextResponse.json({ message: walletReadError.message }, { status: 500 });
    }

    if (walletRow?.id) {
      const currentBalance = Math.max(0, Math.floor(Number(walletRow.balance_consumption_points ?? 0)));
      const { error: walletUpdateError } = await admin
        .from("user_wallets")
        .update({
          balance_consumption_points: currentBalance + OFFER_CREDITS_AMOUNT,
          updated_at: new Date().toISOString(),
        })
        .eq("id", walletRow.id);
      if (walletUpdateError) {
        return NextResponse.json({ message: walletUpdateError.message }, { status: 500 });
      }
    } else {
      const { error: walletInsertError } = await admin.from("user_wallets").insert({
        user_id: user.id,
        balance_consumption_points: OFFER_CREDITS_AMOUNT,
        balance_exchange_points: 0,
      });
      if (walletInsertError) {
        return NextResponse.json({ message: walletInsertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, alreadyClaimed: false, creditsAdded: OFFER_CREDITS_AMOUNT });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de créditer le wallet.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
