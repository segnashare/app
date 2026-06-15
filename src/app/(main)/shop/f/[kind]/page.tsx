import { notFound } from "next/navigation";

import { MainContent } from "@/components/layout/MainContent";
import { ShopCatalog, type ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { getCurrentAuthUser, getCurrentUserAppState } from "@/lib/auth/current-user-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loadShopBoutiqueFilterFacetResponses,
} from "@/lib/shop/shop-boutique-data-cache";
import {
  buildShopCatalogFilterPageTitle,
  filterShopCatalogItemsByFilter,
  isShopCatalogFilterKind,
  normalizeShopCatalogFilterIds,
  type ShopCatalogFilterKind,
} from "@/lib/shop/shop-catalog-filter";
import { loadShopCatalogFilterItems } from "@/lib/shop/load-shop-section-items";
import { mapCategoryFilterRows, mapFilterRows, mapSizeFilterRows } from "@/lib/shop/shop-filter-options";
import { resolveShopCatalogCoverUrlsServer } from "@/lib/shop/resolve-shop-catalog-cover-urls-server";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

type PageProps = {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ ids?: string }>;
};

export default async function ShopCatalogFilterPage({ params, searchParams }: PageProps) {
  const { kind: rawKind } = await params;
  const kind = rawKind.trim().toLowerCase();
  if (!isShopCatalogFilterKind(kind)) {
    notFound();
  }

  const sp = await searchParams;
  const filterIds = normalizeShopCatalogFilterIds((sp.ids ?? "").split(/[\s,]+/));
  if (filterIds.length === 0) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const { user } = await getCurrentAuthUser();
  if (!user) {
    return null;
  }
  const userState = await getCurrentUserAppState(user.id);
  const isDemoMode = userState.onboarding_mode === "demo";

  const [facetPack, favRes] = await Promise.all([
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

  const categories = mapCategoryFilterRows(catRes.data);
  const brands = mapFilterRows(brandRes.data);
  const colors = mapFilterRows(colRes.data);
  const materials = mapFilterRows(matRes.data);
  const sizes = mapSizeFilterRows(sizeRes.data);

  const labelById = new Map<string, string>();
  const optionRows =
    kind === "brand"
      ? brands
      : kind === "material"
        ? materials
        : kind === "category"
          ? categories
          : kind === "color"
            ? colors
            : sizes;
  for (const row of optionRows) {
    labelById.set(row.id, row.label);
  }

  const sectionPageTitle = buildShopCatalogFilterPageTitle(kind as ShopCatalogFilterKind, filterIds, labelById);

  const catalogItems = await loadShopCatalogFilterItems(supabase);
  const initialItems: ShopCatalogItem[] = filterShopCatalogItemsByFilter(
    catalogItems,
    kind as ShopCatalogFilterKind,
    filterIds,
    categories,
  );

  const initialCoverUrlById = await resolveShopCatalogCoverUrlsServer(
    supabase as unknown as StorageSignClient,
    initialItems,
  );

  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopCatalog
        mode="section"
        sectionPageTitle={sectionPageTitle}
        initialItems={initialItems}
        initialCoverUrlById={initialCoverUrlById}
        initialLikedItemIds={initialLikedItemIds}
        categories={categories}
        sizes={sizes}
        brands={brands}
        colors={colors}
        materials={materials}
        featuredLenders={[]}
        featuredLenderSectionItemIds={[]}
        guideCartOnboarding={userState.onboarding_process === "panier"}
      />
    </MainContent>
  );
}
