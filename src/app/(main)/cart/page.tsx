import { redirect } from "next/navigation";

import { CartScreen } from "@/components/cart/CartScreen";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { fetchCartPaymentEligibility } from "@/lib/cart/cart-payment-eligibility";
import { fetchActiveCartForUser } from "@/lib/cart/fetch-active-cart-lines";
import type { CartLineRowData } from "@/lib/cart/cart-line-row-data";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import { collectCmsShopItemIdsFromSectionsByKey } from "@/lib/cms/collect-cms-shop-item-ids";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { fetchCmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { fetchWelcomeGiftLandingContent } from "@/lib/cms/welcome-gift-landing";
import {
  canShowWelcomeGiftOffer,
  filterCartOfferFramesForWelcomeGiftEligibility,
} from "@/lib/cms/welcome-gift-offer-visibility";
import { hasOnboardingIncludedCreditsGrant, resolveOnboardingProcessForOfferVisibility } from "@/lib/onboarding/activate-included-credits";
import { fetchBorrowCheckoutOptions } from "@/lib/billing/fetch-borrow-checkout-options";
import { fetchPanierSectionOrder } from "@/lib/cms/fetch-panier-section-order";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";
import { createPerfTracker } from "@/lib/perf/server-timing";
import { fetchCartOutfitSuggestions } from "@/lib/shop/fetch-cart-outfit-suggestions";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseDemoAdminClient } from "@/lib/supabase/demo-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel, type MembershipLabel } from "@/lib/user/resolve-membership-label";
import { parseUserWalletPointsRow } from "@/lib/wallet/user-wallet-row";

/** Blocs catalogue AUTO rendus nativement sur le panier (pas de frames `get_cms_section_frames`). */
const PANIER_NATIVE_SHOP_SYSTEM_KEYS = new Set<string>(["shop_system_for_you"]);

type CatalogRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function mergeShopCatalogItemsDedupe(a: ShopCatalogItem[], b: ShopCatalogItem[]): ShopCatalogItem[] {
  const m = new Map<string, ShopCatalogItem>();
  for (const it of a) m.set(it.id, it);
  for (const it of b) {
    if (!m.has(it.id)) m.set(it.id, it);
  }
  return [...m.values()];
}

export default async function CartPage() {
  const perf = createPerfTracker("page:/cart");
  const supabase = await createSupabaseServerClient();
  const { user } = await perf.measure("auth.getUser", getCurrentAuthUser);

  if (!user) {
    redirect("/auth/login");
  }

  const userId = user.id as string;
  const admin = createSupabaseAdminClient() as any;
  const [userState, membershipLabel, walletRes, paymentEligibility, includedCreditsClaimed] = (await Promise.all([
    perf.measure("users.appState", () => getCurrentUserAppState(userId)),
    perf.measure("membership.label", () => resolveMembershipLabel(supabase, userId)),
    perf.measure("wallet.read", () =>
      supabase
        .from("user_wallets")
        .select("balance_points, balance_consumption_points, balance_exchange_points")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle(),
    ),
    perf.measure("cart.paymentEligibility", () => fetchCartPaymentEligibility(supabase as any, admin, userId)),
    perf.measure("wallet.onboardingGrant", () => hasOnboardingIncludedCreditsGrant(admin, userId)),
  ])) as [
    Awaited<ReturnType<typeof getCurrentUserAppState>>,
    MembershipLabel,
    { data: unknown },
    Awaited<ReturnType<typeof fetchCartPaymentEligibility>>,
    boolean,
  ];
  const onboardingProcess = await resolveOnboardingProcessForOfferVisibility(
    admin,
    userId,
    userState?.onboarding_process ?? null,
    includedCreditsClaimed,
  );
  const welcomeGiftOfferEligible = canShowWelcomeGiftOffer(onboardingProcess, includedCreditsClaimed);

  const walletPoints = parseUserWalletPointsRow(walletRes.data as Record<string, unknown>);
  const isDemoMode = userState?.onboarding_mode === "demo";
  const showOfferInAppOnboarding =
    userState?.onboarding_process === "panier" || userState?.onboarding_process === "offer";
  if (userState?.onboarding_process === "panier") {
    await perf.measure("users.onboardingOffer", () =>
      supabase
        .from("users")
        .update({ onboarding_process: "offer" })
        .eq("id", userId)
        .eq("onboarding_process", "panier"),
    );
  }
  const demoAdmin = isDemoMode ? createSupabaseDemoAdminClient() : null;
  const catalogSb = (demoAdmin ?? supabase) as unknown as CatalogRpcClient;
  const demoWalletPoints = {
    total: 1200,
    consumption: 700,
    exchange: 500,
  };
  const availablePoints = isDemoMode ? demoWalletPoints.total : walletPoints.total;

  const [panierSectionOrder, borrowCheckoutOptions] = await Promise.all([
    perf.measure("cms.panier.order", () => fetchPanierSectionOrder(supabase)),
    perf.measure("billing.borrowCheckoutOptions", () => fetchBorrowCheckoutOptions(supabase as never)),
  ]);
  const needsShopSystemForYou = panierSectionOrder.includes("shop_system_for_you");

  const tuple = (await Promise.all([
    perf.measure("cart.active", () => fetchActiveCartForUser(supabase as never, userId)),
    needsShopSystemForYou
      ? perf.measure("rpc.get_shop_catalog_items", () => catalogSb.rpc("get_shop_catalog_items", { p_limit: 96 }))
      : Promise.resolve({ data: { items: [] }, error: null }),
  ])) as unknown as [
    { cartId: string | null; status: string | null; lines: CartLineRowData[] },
    { data: unknown; error: { message?: string } | null },
  ];
  const [activeCart, catalogForYouRes] = tuple;
  const cartLinesBase = activeCart.lines;

  const cartForYouPayload = (catalogForYouRes.data ?? { items: [] }) as { items?: ShopCatalogItem[] };
  const cartShopSystemForYouItems = Array.isArray(cartForYouPayload.items) ? cartForYouPayload.items : [];

  const cmsKeys = panierSectionOrder.filter(
    (k) => !k.startsWith("cart_system_") && !PANIER_NATIVE_SHOP_SYSTEM_KEYS.has(k),
  );
  const cmsSectionsByKey: Record<string, { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay }> = {};
  await Promise.all(
    cmsKeys.map(async (sectionKey) => {
      const [frames, display] = await Promise.all([
        perf.measure(`cms.${sectionKey}.frames`, () => fetchCmsSectionFramesResolved(supabase, sectionKey)),
        perf.measure(`cms.${sectionKey}.display`, () => fetchCmsSectionPublishedDisplay(supabase, sectionKey)),
      ]);
      const visibleFrames = filterCartOfferFramesForWelcomeGiftEligibility(
        frames,
        onboardingProcess,
        includedCreditsClaimed,
      );
      cmsSectionsByKey[sectionKey] = { frames: visibleFrames, display };
    }),
  );

  const itemIdsForOutfit = [...new Set(cartLinesBase.map((l) => l.itemId))];
  const cartOutfitSuggestionItems =
    itemIdsForOutfit.length > 0
      ? await perf.measure("cart.outfitSuggestions", () =>
          fetchCartOutfitSuggestions(catalogSb, itemIdsForOutfit, {
            excludeItemIds: itemIdsForOutfit,
            limit: 10,
          }),
        )
      : [];

  const cmsShopItemIds = collectCmsShopItemIdsFromSectionsByKey(cmsSectionsByKey);
  const cmsShopHubCatalogItemsBase = await perf.measure("cms.shopItems", () => fetchShopCatalogItemsByIds(supabase, cmsShopItemIds));
  const cmsShopHubCatalogItems = mergeShopCatalogItemsDedupe(
    mergeShopCatalogItemsDedupe(cmsShopHubCatalogItemsBase, cartShopSystemForYouItems),
    cartOutfitSuggestionItems,
  );

  const itemIdsForComp = [...new Set(cartLinesBase.map((l) => l.itemId))];
  let cartLines = cartLinesBase;
  if (itemIdsForComp.length > 0) {
    const compRes = (await perf.measure("cart.competition", () =>
      supabase.rpc("get_cart_items_competition_state", { p_item_ids: itemIdsForComp }),
    )) as { data: unknown; error: { message?: string } | null };
    if (compRes.error == null) {
      cartLines = mergeCompetitionIntoCartLines(cartLinesBase, compRes.data);
    }
  }
  const includedCreditsActivationContent = welcomeGiftOfferEligible
    ? await perf.measure("cms.includedCredits", () => fetchWelcomeGiftLandingContent(supabase))
    : null;

  perf.log({
    cartLines: cartLines.length,
    cmsSections: cmsKeys.length,
    recommendations: cmsShopHubCatalogItems.length,
  });

  return (
    <main className="flex w-full flex-col bg-zinc-100">
      <CartScreen
        initialLines={cartLines}
        activeCartId={activeCart.cartId}
        cartStatus={activeCart.status}
        membershipLabel={membershipLabel}
        availablePoints={availablePoints}
        balanceConsumptionPoints={isDemoMode ? demoWalletPoints.consumption : walletPoints.consumption}
        balanceExchangePoints={isDemoMode ? demoWalletPoints.exchange : walletPoints.exchange}
        hasReachedLendingCap={false}
        panierSectionOrder={panierSectionOrder}
        cmsSectionsByKey={cmsSectionsByKey}
        cmsShopHubCatalogItems={cmsShopHubCatalogItems}
        cartShopSystemForYouItems={cartShopSystemForYouItems}
        cartOutfitSuggestionItems={cartOutfitSuggestionItems}
        showOfferOnboarding={showOfferInAppOnboarding}
        welcomeGiftOfferEligible={welcomeGiftOfferEligible}
        includedCreditsActivationContent={includedCreditsActivationContent}
        profileComplete={paymentEligibility.profileComplete}
        kycVerified={paymentEligibility.kycVerified}
        borrowCheckoutOptions={borrowCheckoutOptions}
      />
    </main>
  );
}
