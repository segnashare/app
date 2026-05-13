import { redirect } from "next/navigation";

import { CartPaymentScreen } from "@/components/cart/CartPaymentScreen";
import { EXCHANGE_CREDIT_CENTS_PER_MOD } from "@/lib/cart/exchangeCredits";
import { fetchActiveCartForUser } from "@/lib/cart/fetch-active-cart-lines";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import type { CheckoutDeliveryAddress } from "@/lib/cart/checkout-delivery-storage";
import {
  formatIncludedShippingForfaitLine,
  parseIncludedOrdersLimitThisMonth,
  parseRemainingIncludedOrdersThisMonth,
} from "@/lib/billing/membership-included-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { walletCreditKindForMembership } from "@/lib/wallet/credit-kind";
import { parseUserWalletPointsRow } from "@/lib/wallet/user-wallet-row";

type CartPaymentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function tryDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readProfileDeliveryAddress(row: Record<string, unknown> | null | undefined): CheckoutDeliveryAddress | null {
  if (!row) return null;
  const profileData = (row.profile_data ?? {}) as Record<string, unknown>;
  const location = (profileData.location ?? {}) as Record<string, unknown>;
  const label = typeof location.label === "string" ? location.label.trim() : "";
  const lat = typeof location.lat === "number" ? location.lat : Number(location.lat);
  const lon = typeof location.lon === "number" ? location.lon : Number(location.lon);

  if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    label,
    lat,
    lon,
    city: typeof row.city === "string" ? row.city : null,
    relativeCity: typeof location.relative_city === "string" ? location.relative_city : null,
    timezone: typeof location.timezone === "string" ? location.timezone : "Europe/Paris",
  };
}

export default async function CartPaymentPage({ searchParams }: CartPaymentPageProps) {
  const sp = await searchParams;
  const checkoutRaw = sp.checkout;
  const checkout = Array.isArray(checkoutRaw) ? checkoutRaw[0] : checkoutRaw;
  const reasonRaw = sp.reason;
  const reason = Array.isArray(reasonRaw) ? reasonRaw[0] : reasonRaw;
  const detailRaw = sp.detail;
  const detail = Array.isArray(detailRaw) ? detailRaw[0] : detailRaw;
  const postStripeSyncError =
    checkout === "error" && reason
      ? { reason, detail: detail ? tryDecodeURIComponent(detail) : undefined }
      : null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const userId = user.id as string;
  const membershipLabel = await resolveMembershipLabel(supabase, userId);
  const { data: profileRow } = await supabase
    .from("user_profiles")
    .select("city, profile_data")
    .eq("user_id", userId)
    .maybeSingle();
  const profileDeliveryAddress = readProfileDeliveryAddress(profileRow as Record<string, unknown> | null);
  const isGuest = membershipLabel === "Guest";
  const { data: membershipState } = await supabase.rpc("get_current_membership_state");
  const remainingIncludedOrdersThisMonth = parseRemainingIncludedOrdersThisMonth(membershipState);
  const includedOrdersLimitThisMonth = parseIncludedOrdersLimitThisMonth(membershipState);
  const waiveIncludedRoundTripShipping = !isGuest && remainingIncludedOrdersThisMonth > 0;
  const includedShippingForfaitLine =
    waiveIncludedRoundTripShipping && includedOrdersLimitThisMonth > 0
      ? formatIncludedShippingForfaitLine(membershipLabel, includedOrdersLimitThisMonth)
      : undefined;

  const activeCart = await fetchActiveCartForUser(supabase, userId);
  const canPay = activeCart.status === "checkout_pending";
  if (!canPay) {
    redirect("/cart");
  }

  const linesBase = activeCart.lines;
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

  if (lines.some((l) => l.reservedByOther)) {
    redirect("/cart");
  }

  const cartTotalMods = lines.reduce((sum, line) => sum + line.pricePoints, 0);
  const walletRes = await supabase
    .from("user_wallets")
    .select("balance_points, balance_consumption_points, balance_exchange_points")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  const availableWalletMods = parseUserWalletPointsRow(walletRes.data as Record<string, unknown>).total;
  /** Même logique que le panier : seuls les crédits au-delà du solde sont facturés en €. */
  const cartExceedsWallet = cartTotalMods > availableWalletMods;
  const missingExchangeMods = cartExceedsWallet ? Math.max(0, cartTotalMods - availableWalletMods) : 0;
  const exchangeCreditsChargeEuros = (missingExchangeMods * EXCHANGE_CREDIT_CENTS_PER_MOD) / 100;

  return (
    <main className="min-h-[100dvh] w-full bg-white">
      <CartPaymentScreen
        initialLines={lines}
        walletCreditKind={walletCreditKindForMembership(membershipLabel)}
        exchangeCreditsChargeEuros={exchangeCreditsChargeEuros}
        availableWalletMods={availableWalletMods}
        hideReservationTimer={false}
        waiveIncludedRoundTripShipping={waiveIncludedRoundTripShipping}
        remainingIncludedOrdersThisMonth={remainingIncludedOrdersThisMonth}
        includedOrdersLimitThisMonth={includedOrdersLimitThisMonth}
        includedShippingForfaitLine={includedShippingForfaitLine}
        postStripeSyncError={postStripeSyncError}
        initialProfileDeliveryAddress={profileDeliveryAddress}
      />
    </main>
  );
}
