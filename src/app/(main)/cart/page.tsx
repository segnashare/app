import { redirect } from "next/navigation";

import { CartScreen } from "@/components/cart/CartScreen";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { fetchActiveCartLinesForUser, fetchActiveCartSummaryForUser } from "@/lib/cart/fetch-active-cart-lines";
import { mergeCompetitionIntoCartLines } from "@/lib/cart/merge-cart-competition";
import { collectCmsShopItemIdsFromSectionsByKey } from "@/lib/cms/collect-cms-shop-item-ids";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { fetchCmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { fetchPanierSectionOrder } from "@/lib/cms/fetch-panier-section-order";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import type { CmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMembershipLabel } from "@/lib/user/resolve-membership-label";
import { parseUserWalletPointsRow } from "@/lib/wallet/user-wallet-row";

const INSURANCE_EUROS = 2.99;

/** Blocs catalogue AUTO rendus nativement sur le panier (pas de frames `get_cms_section_frames`). */
const PANIER_NATIVE_SHOP_SYSTEM_KEYS = new Set<string>(["shop_system_for_you"]);

function mergeShopCatalogItemsDedupe(a: ShopCatalogItem[], b: ShopCatalogItem[]): ShopCatalogItem[] {
  const m = new Map<string, ShopCatalogItem>();
  for (const it of a) m.set(it.id, it);
  for (const it of b) {
    if (!m.has(it.id)) m.set(it.id, it);
  }
  return [...m.values()];
}

export default async function CartPage() {
  const supabase = (await createSupabaseServerClient()) as any;
  const anySb = supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const userId = user.id as string;
  const [membershipLabel, walletRes] = await Promise.all([
    resolveMembershipLabel(supabase, userId),
    supabase
      .from("user_wallets")
      .select("balance_points, balance_consumption_points, balance_exchange_points")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  const walletPoints = parseUserWalletPointsRow(walletRes.data as Record<string, unknown>);
  const availablePoints = walletPoints.total;

  const panierSectionOrder = await fetchPanierSectionOrder(supabase);
  const needsShopSystemForYou = panierSectionOrder.includes("shop_system_for_you");

  const [cartLinesBase, cartSummary, catalogForYouRes] = await Promise.all([
    fetchActiveCartLinesForUser(supabase, userId),
    fetchActiveCartSummaryForUser(supabase, userId),
    needsShopSystemForYou
      ? anySb.rpc("get_shop_catalog_items", { p_limit: 160 })
      : Promise.resolve({ data: { items: [] }, error: null }),
  ]);

  const cartForYouPayload = (catalogForYouRes.data ?? { items: [] }) as { items?: ShopCatalogItem[] };
  const cartShopSystemForYouItems = Array.isArray(cartForYouPayload.items) ? cartForYouPayload.items : [];

  const cmsKeys = panierSectionOrder.filter(
    (k) => !k.startsWith("cart_system_") && !PANIER_NATIVE_SHOP_SYSTEM_KEYS.has(k),
  );
  const cmsSectionsByKey: Record<string, { frames: CmsFrameRow[]; display: CmsSectionPublishedDisplay }> = {};
  await Promise.all(
    cmsKeys.map(async (sectionKey) => {
      const [frames, display] = await Promise.all([
        fetchCmsSectionFramesResolved(supabase, sectionKey),
        fetchCmsSectionPublishedDisplay(supabase, sectionKey),
      ]);
      cmsSectionsByKey[sectionKey] = { frames, display };
    }),
  );

  const cmsShopItemIds = collectCmsShopItemIdsFromSectionsByKey(cmsSectionsByKey);
  const cmsShopHubCatalogItemsBase = await fetchShopCatalogItemsByIds(supabase, cmsShopItemIds);
  const cmsShopHubCatalogItems = mergeShopCatalogItemsDedupe(cmsShopHubCatalogItemsBase, cartShopSystemForYouItems);

  const itemIdsForComp = [...new Set(cartLinesBase.map((l) => l.itemId))];
  let cartLines = cartLinesBase;
  if (itemIdsForComp.length > 0) {
    const compRes = await supabase.rpc("get_cart_items_competition_state", { p_item_ids: itemIdsForComp });
    if (compRes.error == null) {
      cartLines = mergeCompetitionIntoCartLines(cartLinesBase, compRes.data);
    }
  }

  return (
    <main className="flex w-full flex-col bg-zinc-100">
      <CartScreen
        initialLines={cartLines}
        activeCartId={cartSummary.cartId}
        cartStatus={cartSummary.status}
        membershipLabel={membershipLabel}
        availablePoints={availablePoints}
        balanceConsumptionPoints={walletPoints.consumption}
        balanceExchangePoints={walletPoints.exchange}
        hasReachedLendingCap={false}
        insuranceEuros={INSURANCE_EUROS}
        panierSectionOrder={panierSectionOrder}
        cmsSectionsByKey={cmsSectionsByKey}
        cmsShopHubCatalogItems={cmsShopHubCatalogItems}
        cartShopSystemForYouItems={cartShopSystemForYouItems}
      />
    </main>
  );
}
