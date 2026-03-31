import { redirect } from "next/navigation";

import { CartPaymentScreen } from "@/components/cart/CartPaymentScreen";
import { EXCHANGE_CREDIT_CENTS_PER_MOD } from "@/lib/cart/exchangeCredits";
import { fetchActiveCartLinesForUser } from "@/lib/cart/fetch-active-cart-lines";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

export default async function CartPaymentPage() {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const userId = user.id as string;
  const membershipLabel = await resolveMembershipLabel(supabase, userId);
  const isGuest = membershipLabel === "Guest";
  const hideWalletReservationChrome = membershipLabel === "Guest" || membershipLabel === "Membre +";

  const linesBase = await fetchActiveCartLinesForUser(supabase, userId);
  if (linesBase.length === 0) {
    redirect("/cart");
  }

  const itemIdsForComp = [...new Set(linesBase.map((l) => l.itemId))];
  let lines = linesBase;
  if (itemIdsForComp.length > 0) {
    const compRes = await supabase.rpc("get_cart_items_competition_state", { p_item_ids: itemIdsForComp });
    if (compRes.error == null) {
      lines = mergeCompetitionIntoCartLines(linesBase, compRes.data);
    }
  }

  if (lines.some((l) => l.reservedByOther) && !isGuest) {
    redirect("/cart");
  }

  const subtotalMods = lines.reduce((sum, line) => sum + line.pricePoints, 0);
  const subtotalEuros = (subtotalMods * EXCHANGE_CREDIT_CENTS_PER_MOD) / 100;

  return (
    <main className="min-h-[100dvh] w-full bg-zinc-100">
      <CartPaymentScreen
        initialLines={lines}
        subtotalEuros={subtotalEuros}
        hideReservationTimer={isGuest}
        hideWalletReservationChrome={hideWalletReservationChrome}
      />
    </main>
  );
}
