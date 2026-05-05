import { MainContent } from "@/components/layout/MainContent";
import { ShopCatalog, type ShopCatalogItem } from "@/components/shop/ShopCatalog";
import type { CmsCatalogSectionBundle } from "@/lib/cms/fetch-cms-catalog-section";
import { fetchCmsCatalogSectionResolved } from "@/lib/cms/fetch-cms-catalog-section";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { fetchCmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { fetchBoutiqueHubSectionOrder } from "@/lib/cms/fetch-boutique-hub-section-order";
import { SHOP_HUB_SECTION_KEYS } from "@/lib/cms/shop-hub-sections";
import { fetchShopCatalogItemsByIds } from "@/lib/shop/fetch-shop-catalog-items-by-ids";
import { loadFauxProfileLenders } from "@/lib/shop/load-faux-profile-lenders";
import { padFeaturedLendersToNine } from "@/lib/shop/placeholder-lenders";
import { buildShopDepartmentHubRail } from "@/lib/shop/shop-department-categories";
import { createSupabaseDemoAdminClient } from "@/lib/supabase/demo-admin";
import { mapCategoryFilterRows, mapFilterRows } from "@/lib/shop/shop-filter-options";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ShopPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data: userState } = await supabase
    .from("users")
    .select("onboarding_mode")
    .eq("id", user.id)
    .maybeSingle<{ onboarding_mode?: string | null }>();

  const isDemoMode = userState?.onboarding_mode === "demo";
  const demoAdmin = isDemoMode ? createSupabaseDemoAdminClient() : null;
  const catalogDb = (demoAdmin ?? supabase) as any;
  const catalogSb = catalogDb as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    from: (t: string) => {
      select: (c: string) => {
        order: (c: string, o?: { ascending?: boolean }) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };

  const [
    catalogResFinal,
    mostLikedResFinal,
    catResFinal,
    sizeResFinal,
    brandResFinal,
    colResFinal,
    matResFinal,
    favRes,
    cmsShopFrames,
    shopHomeCapsulesDisplay,
    cmsHubDiscover,
    cmsHubCategories,
    cmsHubPreferredBrands,
    cmsHubDeals,
    cmsHubFrench,
    boutiqueHubSectionOrder,
  ] = await Promise.all([
    catalogSb.rpc("get_shop_catalog_items", { p_limit: 160 }),
    catalogSb.rpc("get_shop_most_liked_items", { p_limit: 10 }),
    catalogSb.from("item_categories").select("id,name,parent_category_id").order("name", { ascending: true }),
    catalogSb.from("sizes").select("id,label").order("label", { ascending: true }),
    catalogSb.from("item_brands").select("id,label").order("label", { ascending: true }),
    catalogSb.from("item_couleurs").select("id,label").order("label", { ascending: true }),
    catalogSb.from("item_materiaux").select("id,label").order("label", { ascending: true }),
    supabase
      .from("item_favorites")
      .select("item_id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    fetchCmsSectionFramesResolved(supabase, "shop_home_capsules"),
    fetchCmsSectionPublishedDisplay(supabase, "shop_home_capsules"),
    fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.discover),
    fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.categories),
    fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.preferredBrands),
    fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.deals),
    fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.french),
    fetchBoutiqueHubSectionOrder(supabase),
  ]);

  if (process.env.SEGNA_DEBUG_CMS === "1") {
    const categoriesTree = mapCategoryFilterRows(catResFinal.data);
    const railDbg = buildShopDepartmentHubRail(categoriesTree, cmsHubCategories.frames);
    console.info(
      "[SEGNA_DEBUG_CMS] rail Catégories (buildShopDepartmentHubRail):",
      railDbg.length,
      railDbg.map((d) => ({
        slug: d.slug,
        label: d.label,
        frameId: d.linkFrame?.id,
        target_url:
          d.linkFrame && typeof d.linkFrame.payload.target_url === "string"
            ? d.linkFrame.payload.target_url
            : "",
      })),
    );
  }

  const catalogPayload = (catalogResFinal.data ?? { items: [] }) as { items?: ShopCatalogItem[] };
  const initialItems = Array.isArray(catalogPayload.items) ? catalogPayload.items : [];

  const hubBundles: Record<string, CmsCatalogSectionBundle | undefined> = {
    discover: cmsHubDiscover,
    categories: cmsHubCategories,
    preferredBrands: cmsHubPreferredBrands,
    deals: cmsHubDeals,
    french: cmsHubFrench,
  };

  const hubReferencedItemIds = new Set<string>();
  for (const b of Object.values(hubBundles)) {
    for (const f of b?.frames ?? []) {
      if (f.frame_type !== "shop_item_ref") continue;
      const id = typeof f.payload.item_id === "string" ? f.payload.item_id.trim() : "";
      if (id) hubReferencedItemIds.add(id);
    }
  }

  const inInitialCatalog = new Set(initialItems.map((i) => i.id));
  const idsToFetchForHub = [...hubReferencedItemIds].filter((id) => !inInitialCatalog.has(id));
  const hubExtraItems = await fetchShopCatalogItemsByIds(catalogDb, idsToFetchForHub);
  const initialItemsForShop = [...initialItems];
  for (const it of hubExtraItems) {
    if (!inInitialCatalog.has(it.id)) {
      initialItemsForShop.push(it);
      inInitialCatalog.add(it.id);
    }
  }

  const mostLikedPayload = (mostLikedResFinal.error ? { items: [] } : (mostLikedResFinal.data ?? { items: [] })) as {
    items?: ShopCatalogItem[];
  };
  const initialMostLikedItems = Array.isArray(mostLikedPayload.items) ? mostLikedPayload.items : [];

  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  /** Section « supers prêteuses » : visuels locaux `public/ressources/faux_profils` (nom = fichier sans extension). */
  const featuredLendersFromAssets = loadFauxProfileLenders();
  const featuredLendersPadded = padFeaturedLendersToNine(featuredLendersFromAssets);
  const featuredLenderSectionItemIds: string[] = [];

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopCatalog
        initialItems={initialItemsForShop}
        initialLikedItemIds={initialLikedItemIds}
        initialMostLikedItems={initialMostLikedItems}
        categories={mapCategoryFilterRows(catResFinal.data)}
        sizes={mapFilterRows(sizeResFinal.data)}
        brands={mapFilterRows(brandResFinal.data)}
        colors={mapFilterRows(colResFinal.data)}
        materials={mapFilterRows(matResFinal.data)}
        featuredLenders={featuredLendersPadded}
        featuredLenderSectionItemIds={featuredLenderSectionItemIds}
        initialCmsShopFrames={cmsShopFrames}
        shopHomeCapsulesSectionDisplay={shopHomeCapsulesDisplay}
        initialShopHubSections={{
          discover: cmsHubDiscover,
          categories: cmsHubCategories,
          preferredBrands: cmsHubPreferredBrands,
          deals: cmsHubDeals,
          french: cmsHubFrench,
        }}
        boutiqueHubSectionOrder={boutiqueHubSectionOrder}
      />
    </MainContent>
  );
}
