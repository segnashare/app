import { redirect } from "next/navigation";

import { CartScreen } from "@/components/cart/CartScreen";
import { fetchActiveCartLinesForUser, fetchActiveCartSummaryForUser } from "@/lib/cart/fetch-active-cart-lines";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";

const INSURANCE_EUROS = 2.99;

export default async function CartPage() {
  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const userId = user.id as string;
  const nowIso = new Date().toISOString();

  const [membershipLabel, walletRes, holdsRes] = await Promise.all([
    resolveMembershipLabel(supabase, userId),
    supabase.from("user_wallets").select("balance_points").eq("user_id", userId).is("deleted_at", null).maybeSingle(),
    supabase.from("wallet_holds").select("amount_points").eq("user_id", userId).eq("status", "active").gt("expires_at", nowIso),
  ]);

  const totalPoints = Number(walletRes.data?.balance_points ?? 0);
  const blockedPoints = (holdsRes.data ?? []).reduce(
    (sum: number, hold: { amount_points?: number | null }) => sum + Number(hold.amount_points ?? 0),
    0,
  );
  const availablePoints = Math.max(0, totalPoints - blockedPoints);

  const [cartLinesBase, cartSummary] = await Promise.all([
    fetchActiveCartLinesForUser(supabase, userId),
    fetchActiveCartSummaryForUser(supabase, userId),
  ]);

  const itemIdsForComp = [...new Set(cartLinesBase.map((l) => l.itemId))];
  let cartLines = cartLinesBase;
  if (itemIdsForComp.length > 0) {
    const compRes = await supabase.rpc("get_cart_items_competition_state", { p_item_ids: itemIdsForComp });
    if (compRes.error == null) {
      cartLines = mergeCompetitionIntoCartLines(cartLinesBase, compRes.data);
    }
  }

  const showSubscriptionUpsell = membershipLabel === "Guest" || membershipLabel === "Membre +";
  const subscriptionUpsellHref = membershipLabel === "Membre +" ? "/package?plan=minus" : "/package?plan=plus";

  return (
    <main className="flex w-full flex-col bg-zinc-100">
      <CartScreen
        initialLines={cartLines}
        activeCartId={cartSummary.cartId}
        cartStatus={cartSummary.status}
        membershipLabel={membershipLabel}
        availablePoints={availablePoints}
        hasReachedLendingCap={false}
        insuranceEuros={INSURANCE_EUROS}
        showSubscriptionUpsell={showSubscriptionUpsell}
        subscriptionUpsellHref={subscriptionUpsellHref}
      />
    </main>
  );
}
