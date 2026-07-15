import { notFound } from "next/navigation";

import { MainContent } from "@/components/layout/MainContent";
import { ShopCatalog, type ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadShopCatalogItemsByTagPageSlug } from "@/lib/shop/load-shop-tag-page";
import { resolveShopPageSlug } from "@/lib/shop/resolve-shop-page-slug";
import {
  loadShopBoutiqueFilterFacetResponses,
} from "@/lib/shop/shop-boutique-data-cache";
import { mapCategoryFilterRows, mapFilterRows, mapSizeFilterRows } from "@/lib/shop/shop-filter-options";
import {
  loadShopMaterialSectionItems,
  loadShopSectionItems,
  SHOP_SECTION_TITLES,
  type ShopSectionSlug,
} from "@/lib/shop/load-shop-section-items";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import { resolveShopGuestCashRental } from "@/lib/shop/resolve-shop-guest-cash-rental";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ShopSectionPage({ params }: PageProps) {
  const { slug: raw } = await params;
  const rawSlug = raw.trim();
  if (!rawSlug) notFound();

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
  const guestCashRental = await resolveShopGuestCashRental(supabase, user.id);

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

  const materials = mapFilterRows(matRes.data);
  const categoryRows = mapCategoryFilterRows(catRes.data);
  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  const pageSlug = resolveShopPageSlug(rawSlug, materials);
  if (!pageSlug) {
    const tagPack = await loadShopCatalogItemsByTagPageSlug(
      supabase as unknown as Parameters<typeof loadShopCatalogItemsByTagPageSlug>[0],
      rawSlug,
    );
    if (!tagPack.tag) notFound();

    const initialItems: ShopCatalogItem[] = tagPack.items;
    const initialCoverUrlById = await resolveShopCatalogCoverUrlsServer(
      supabase as unknown as StorageSignClient,
      initialItems,
    );

    return (
      <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
        <ShopCatalog
          mode="section"
          sectionPageTitle={tagPack.tag.label}
          initialItems={initialItems}
          initialCoverUrlById={initialCoverUrlById}
          initialLikedItemIds={initialLikedItemIds}
          categories={categoryRows}
          sizes={mapSizeFilterRows(sizeRes.data)}
          brands={mapFilterRows(brandRes.data)}
          colors={mapFilterRows(colRes.data)}
          materials={materials}
          featuredLenders={[]}
          featuredLenderSectionItemIds={[]}
          guideCartOnboarding={userState.onboarding_process === "panier"}
          guestCashRental={guestCashRental}
        />
      </MainContent>
    );
  }

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
      .in("status", ["available", "in_cart", "reserved", "sold"])
      .limit(80);
    featuredLenderItemIds = (itemRows ?? [])
      .map((r) => (r as { id?: string }).id)
      .filter((id): id is string => typeof id === "string");
  }

  let sectionCatalogClient: unknown = supabase;
  if (pageSlug.kind === "section" && pageSlug.slug === "collection-segna") {
    try {
      sectionCatalogClient = createSupabaseAdminClient();
    } catch {
      sectionCatalogClient = supabase;
    }
  }

  const sectionPageTitle =
    pageSlug.kind === "material" ? pageSlug.title : SHOP_SECTION_TITLES[pageSlug.slug as ShopSectionSlug];

  const initialItems: ShopCatalogItem[] =
    pageSlug.kind === "material"
      ? await loadShopMaterialSectionItems(sectionCatalogClient, pageSlug.materialIds)
      : await loadShopSectionItems(sectionCatalogClient, pageSlug.slug, {
          userId: user.id,
          featuredLenderItemIds,
          preferredBrandIds,
          categoryRows,
        });

  const initialCoverUrlById = await resolveShopCatalogCoverUrlsServer(
    sectionCatalogClient as unknown as StorageSignClient,
    initialItems,
  );

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopCatalog
        mode="section"
        sectionPageTitle={sectionPageTitle}
        initialItems={initialItems}
        initialCoverUrlById={initialCoverUrlById}
        initialLikedItemIds={initialLikedItemIds}
        categories={categoryRows}
        sizes={mapSizeFilterRows(sizeRes.data)}
        brands={mapFilterRows(brandRes.data)}
        colors={mapFilterRows(colRes.data)}
        materials={materials}
        featuredLenders={[]}
        featuredLenderSectionItemIds={[]}
        guideCartOnboarding={userState.onboarding_process === "panier"}
        guestCashRental={guestCashRental}
      />
    </MainContent>
  );
}
