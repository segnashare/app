import { redirect } from "next/navigation";

import { CartUpsellScreen } from "@/components/cart/CartUpsellScreen";
import type { ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { fetchActiveCartForUser } from "@/lib/cart/fetch-active-cart-lines";
import { fetchBorrowCheckoutOptions } from "@/lib/billing/fetch-borrow-checkout-options";
import { fetchCartOutfitSuggestions } from "@/lib/shop/fetch-cart-outfit-suggestions";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import { createSupabaseDemoAdminClient } from "@/lib/supabase/demo-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";

type CatalogRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function outfitInterstitialItems(items: ShopCatalogItem[]): ShopCatalogItem[] {
  return items.filter((item) => item.status === "available" || item.status === "in_cart").slice(0, 10);
}

export default async function CartOutfitPage() {
  const supabase = await createSupabaseServerClient();
  const { user } = await getCurrentAuthUser();

  if (!user) {
    redirect("/auth/login");
  }

  const userId = user.id as string;
  const userState = await getCurrentUserAppState(userId);
  const isDemoMode = userState?.onboarding_mode === "demo";
  const demoAdmin = isDemoMode ? createSupabaseDemoAdminClient() : null;
  const catalogSb = (demoAdmin ?? supabase) as unknown as CatalogRpcClient;

  const activeCart = await fetchActiveCartForUser(supabase as never, userId);
  if (!activeCart.cartId || activeCart.status !== "checkout_pending") {
    redirect("/cart");
  }

  const cartItemIds = [...new Set(activeCart.lines.map((line) => line.itemId))];
  if (cartItemIds.length === 0) {
    redirect("/cart/upsell");
  }

  const [outfitItemsRaw, borrowCheckoutOptions] = await Promise.all([
    fetchCartOutfitSuggestions(catalogSb, cartItemIds, {
      excludeItemIds: cartItemIds,
      limit: 10,
    }),
    fetchBorrowCheckoutOptions(supabase as never),
  ]);
  const outfitItems = outfitInterstitialItems(outfitItemsRaw);

  if (outfitItems.length === 0) {
    redirect("/cart/upsell");
  }

  const initialCoverUrlById = await resolveShopCatalogCoverUrlsServer(supabase, outfitItems);

  return (
    <main className="flex w-full flex-col bg-white">
      <CartUpsellScreen
        title="Complétez votre tenue"
        skipHref="/cart/upsell"
        items={outfitItems}
        initialCoverUrlById={initialCoverUrlById}
        allowInCartItems
        borrowCheckoutOptions={borrowCheckoutOptions}
      />
    </main>
  );
}
