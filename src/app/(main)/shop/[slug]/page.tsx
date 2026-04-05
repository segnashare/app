import { notFound } from "next/navigation";

import { MainContent } from "@/components/layout/MainContent";
import { ShopCatalog, type ShopCatalogItem } from "@/components/shop/ShopCatalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapCategoryFilterRows, mapFilterRows } from "@/lib/shop/shop-filter-options";
import {
  isShopSectionSlug,
  loadShopSectionItems,
  SHOP_SECTION_TITLES,
  type ShopSectionSlug,
} from "@/lib/shop/load-shop-section-items";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const [lendersRes, profileRes, catRes, sizeRes, brandRes, colRes, matRes, favRes] = await Promise.all([
    anySb.rpc("get_shop_featured_lenders", { p_limit: 9 }),
    supabase.from("user_profiles").select("id").eq("user_id", user.id).maybeSingle(),
    anySb.from("item_categories").select("id,name,parent_category_id").order("name", { ascending: true }),
    anySb.from("sizes").select("id,label").order("label", { ascending: true }),
    anySb.from("item_brands").select("id,label").order("label", { ascending: true }),
    anySb.from("item_couleurs").select("id,label").order("label", { ascending: true }),
    anySb.from("item_materiaux").select("id,label").order("label", { ascending: true }),
    supabase
      .from("item_favorites")
      .select("item_id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

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
      .in("status", ["listed", "available", "in_cart", "reserved"])
      .limit(80);
    featuredLenderItemIds = (itemRows ?? [])
      .map((r) => (r as { id?: string }).id)
      .filter((id): id is string => typeof id === "string");
  }

  const categoryRows = mapCategoryFilterRows(catRes.data);

  const initialItems: ShopCatalogItem[] = await loadShopSectionItems(supabase, slug, {
    userId: user.id,
    featuredLenderItemIds,
    preferredBrandIds,
    categoryRows,
  });

  const likedRows = (favRes.data ?? []) as Array<{ item_id?: string }>;
  const initialLikedItemIds = likedRows.map((r) => r.item_id).filter((id): id is string => typeof id === "string");

  return (
    <MainContent className="!space-y-0 !px-0 !pb-28 !pt-0">
      <ShopCatalog
        mode="section"
        sectionPageTitle={SHOP_SECTION_TITLES[slug]}
        initialItems={initialItems}
        initialLikedItemIds={initialLikedItemIds}
        categories={categoryRows}
        sizes={mapFilterRows(sizeRes.data)}
        brands={mapFilterRows(brandRes.data)}
        colors={mapFilterRows(colRes.data)}
        materials={mapFilterRows(matRes.data)}
        featuredLenders={[]}
        featuredLenderSectionItemIds={[]}
      />
    </MainContent>
  );
}
