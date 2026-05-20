import { notFound } from "next/navigation";

import { MainContent } from "@/components/layout/MainContent";
import { ShopCatalog, type ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loadShopBoutiqueFilterFacetResponses,
} from "@/lib/shop/shop-boutique-data-cache";
import { mapCategoryFilterRows, mapFilterRows, mapSizeFilterRows } from "@/lib/shop/shop-filter-options";
import {
  isShopSectionSlug,
  loadShopSectionItems,
  SHOP_SECTION_TITLES,
  type ShopSectionSlug,
} from "@/lib/shop/load-shop-section-items";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ShopSectionPage({ params }: PageProps) {
  const { slug: raw } = await params;
  if (!isShopSectionSlug(raw)) {
    notFound();
  }
  const slug = raw as ShopSectionSlug;

  const supabase = await createSupabaseServerClient();
  const anySb = supabase as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          is: (c: string, v: null) => Promise<{ data: unknown; error: { message?: string } | null }>;
        };
        order: (c: string, o?: { ascending?: boolean }) => Promise<{ data: unknown; error: { message?: string } | null }>;
        maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };

  const { user } = await getCurrentAuthUser();
  if (!user) {
    return null;
  }
  const userState = await getCurrentUserAppState(user.id);
  const isDemoMode = userState.onboarding_mode === "demo";

  const [lendersRes, profileRes, facetPack, favRes] = await Promise.all([
    anySb.rpc("get_shop_featured_lenders", { p_limit: 9 }),
    supabase.from("user_profiles").select("id").eq("user_id", user.id).maybeSingle(),
    loadShopBoutiqueFilterFacetResponses(isDemoMode, supabase),
    supabase
      .from("item_favorites")
      .select("item_id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const { catResFinal: catRes, sizeResFinal: sizeRes, brandResFinal: brandRes, colResFinal: colRes, matResFinal: matRes } =
    facetPack;

  const profileId = (profileRes.data as { id?: string } | null)?.id ?? null;
  let preferredBrandIds: string[] = [];
  if (profileId) {
    const { data: brandRows } = await supabase
      .from("user_profile_brands")
      .select("brand_id")
      .eq("user_profile_id", profileId)
      .order("rank", { ascending: true });
    preferredBrandIds = (brandRows ?? [])
      .map((r) => (r as { brand_id?: string }).brand_id)
      .filter((id): id is string => typeof id === "string");
  }

  const lenderRows =
    lendersRes.error || !Array.isArray(lendersRes.data)
      ? []
      : (lendersRes.data as Array<{ user_id?: string }>);
  const lenderUserIds = lenderRows.map((r) => r.user_id).filter((id): id is string => typeof id === "string");

  let featuredLenderItemIds: string[] = [];
  if (lenderUserIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("items")
      .select("id")
      .in("owner_user_id", lenderUserIds)
      .is("deleted_at", null)
      .in("status", ["available", "in_cart", "reserved"])
      .limit(80);
    featuredLenderItemIds = (itemRows ?? [])
      .map((r) => (r as { id?: string }).id)
      .filter((id): id is string => typeof id === "string");
  }

  const categoryRows = mapCategoryFilterRows(catRes.data);
  let sectionCatalogClient: unknown = supabase;
  if (slug === "collection-segna") {
    try {
      sectionCatalogClient = createSupabaseAdminClient();
    } catch {
      sectionCatalogClient = supabase;
    }
  }

  const initialItems: ShopCatalogItem[] = await loadShopSectionItems(sectionCatalogClient, slug, {
    userId: user.id,
    featuredLenderItemIds,
    preferredBrandIds,
    categoryRows,
  });

  const initialCoverUrlById = await resolveShopCatalogCoverUrlsServer(
    sectionCatalogClient as unknown as StorageSignClient,
    initialItems,
  );

  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopCatalog
        mode="section"
        sectionPageTitle={SHOP_SECTION_TITLES[slug]}
        initialItems={initialItems}
        initialCoverUrlById={initialCoverUrlById}
        initialLikedItemIds={initialLikedItemIds}
        categories={categoryRows}
        sizes={mapSizeFilterRows(sizeRes.data)}
        brands={mapFilterRows(brandRes.data)}
        colors={mapFilterRows(colRes.data)}
        materials={mapFilterRows(matRes.data)}
        featuredLenders={[]}
        featuredLenderSectionItemIds={[]}
        guideCartOnboarding={userState.onboarding_process === "panier"}
      />
    </MainContent>
  );
}
