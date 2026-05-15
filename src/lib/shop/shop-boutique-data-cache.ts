/**
 * Chargeurs boutique (filtres + CMS hub).
 *
 * Les filtres « main project » hors mode démo : un RPC SQL + optionnellement `unstable_cache`
 * via client service role (sans `cookies()`), car Next interdit `cookies()` dans le callback
 * de `unstable_cache`. Les lectures CMS hub restent sur `createSupabaseServerClient()` (URLs
 * signées dépendantes du contexte — pas de cache long ici).
 */
import { unstable_cache } from "next/cache";

import { fetchBoutiqueHubSectionOrder } from "@/lib/cms/fetch-boutique-hub-section-order";
import { fetchCmsCatalogSectionResolved } from "@/lib/cms/fetch-cms-catalog-section";
import { fetchCmsSectionFramesResolved } from "@/lib/cms/fetch-cms-section-frames";
import { fetchCmsSectionPublishedDisplay } from "@/lib/cms/fetch-cms-section-published-config";
import { SHOP_HUB_SECTION_KEYS } from "@/lib/cms/shop-hub-sections";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseDemoAdminClient } from "@/lib/supabase/demo-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ShopFilterFacetQueryResponse = {
  data: unknown;
  error: { message?: string } | null;
};

async function catalogClientForFilters(isDemoMode: boolean) {
  const supabase = await createSupabaseServerClient();
  if (!isDemoMode) return supabase;
  return createSupabaseDemoAdminClient() ?? supabase;
}

async function fetchShopFilterFacetsAdminUncached(): Promise<Record<string, unknown>> {
  const client = tryCreateSupabaseAdminClient();
  if (!client) {
    throw new Error("segna_shop_filters: admin client indisponible");
  }
  const { data, error } = await client.rpc("get_shop_boutique_filter_facets");
  if (error || data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(error?.message ?? "segna_shop_filters: RPC get_shop_boutique_filter_facets invalide");
  }
  return data as Record<string, unknown>;
}

const fetchShopFilterFacetsAdminCached = unstable_cache(fetchShopFilterFacetsAdminUncached, ["shop-boutique-filter-facets-v1"], {
  revalidate: 120,
  tags: ["shop-boutique-filter-facets"],
});

function facetResponsesFromBundle(bundle: Record<string, unknown>): {
  catResFinal: ShopFilterFacetQueryResponse;
  sizeResFinal: ShopFilterFacetQueryResponse;
  brandResFinal: ShopFilterFacetQueryResponse;
  colResFinal: ShopFilterFacetQueryResponse;
  matResFinal: ShopFilterFacetQueryResponse;
} {
  return {
    catResFinal: { data: bundle.categories ?? [], error: null },
    sizeResFinal: { data: bundle.sizes ?? [], error: null },
    brandResFinal: { data: bundle.brands ?? [], error: null },
    colResFinal: { data: bundle.colors ?? [], error: null },
    matResFinal: { data: bundle.materials ?? [], error: null },
  };
}

/**
 * Filtres boutique : 1 RPC (+ cache admin optionnel) sur le projet principal, ou 5 requêtes en mode démo / repli.
 */
export async function loadShopBoutiqueFilterFacetResponses(
  isDemoMode: boolean,
  supabaseForRpc: SupabaseClient<Database>,
): Promise<{
  catResFinal: ShopFilterFacetQueryResponse;
  sizeResFinal: ShopFilterFacetQueryResponse;
  brandResFinal: ShopFilterFacetQueryResponse;
  colResFinal: ShopFilterFacetQueryResponse;
  matResFinal: ShopFilterFacetQueryResponse;
}> {
  if (isDemoMode) {
    const db = await catalogClientForFilters(true);
    const [c, s, b, col, m] = await Promise.all([
      db.from("item_categories").select("id,name,parent_category_id").order("name", { ascending: true }),
      db.from("sizes").select("id,label").order("label", { ascending: true }),
      db.from("item_brands").select("id,label").order("label", { ascending: true }),
      db.from("item_couleurs").select("id,label").order("label", { ascending: true }),
      db.from("item_materiaux").select("id,label").order("label", { ascending: true }),
    ]);
    return {
      catResFinal: c,
      sizeResFinal: s,
      brandResFinal: b,
      colResFinal: col,
      matResFinal: m,
    };
  }

  if (tryCreateSupabaseAdminClient()) {
    try {
      const bundle = await fetchShopFilterFacetsAdminCached();
      return facetResponsesFromBundle(bundle);
    } catch {
      /* migration pas encore poussée ou RPC indisponible : repli ci-dessous */
    }
  }

  const { data, error } = await supabaseForRpc.rpc("get_shop_boutique_filter_facets");
  if (!error && data && typeof data === "object" && !Array.isArray(data)) {
    return facetResponsesFromBundle(data as Record<string, unknown>);
  }

  const db = await catalogClientForFilters(false);
  const [c, s, b, col, m] = await Promise.all([
    db.from("item_categories").select("id,name,parent_category_id").order("name", { ascending: true }),
    db.from("sizes").select("id,label").order("label", { ascending: true }),
    db.from("item_brands").select("id,label").order("label", { ascending: true }),
    db.from("item_couleurs").select("id,label").order("label", { ascending: true }),
    db.from("item_materiaux").select("id,label").order("label", { ascending: true }),
  ]);
  return {
    catResFinal: c,
    sizeResFinal: s,
    brandResFinal: b,
    colResFinal: col,
    matResFinal: m,
  };
}

export async function fetchShopFilterCategoriesCached(isDemoMode: boolean) {
  const db = await catalogClientForFilters(isDemoMode);
  return db.from("item_categories").select("id,name,parent_category_id").order("name", { ascending: true });
}

export async function fetchShopFilterSizesCached(isDemoMode: boolean) {
  const db = await catalogClientForFilters(isDemoMode);
  return db.from("sizes").select("id,label").order("label", { ascending: true });
}

export async function fetchShopFilterBrandsCached(isDemoMode: boolean) {
  const db = await catalogClientForFilters(isDemoMode);
  return db.from("item_brands").select("id,label").order("label", { ascending: true });
}

export async function fetchShopFilterColorsCached(isDemoMode: boolean) {
  const db = await catalogClientForFilters(isDemoMode);
  return db.from("item_couleurs").select("id,label").order("label", { ascending: true });
}

export async function fetchShopFilterMaterialsCached(isDemoMode: boolean) {
  const db = await catalogClientForFilters(isDemoMode);
  return db.from("item_materiaux").select("id,label").order("label", { ascending: true });
}

export async function fetchShopHubDiscoverCached() {
  const supabase = await createSupabaseServerClient();
  return fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.discover);
}

export async function fetchShopHubCategoriesCached() {
  const supabase = await createSupabaseServerClient();
  return fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.categories);
}

export async function fetchShopHubPreferredBrandsCached() {
  const supabase = await createSupabaseServerClient();
  return fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.preferredBrands);
}

export async function fetchShopHubDealsCached() {
  const supabase = await createSupabaseServerClient();
  return fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.deals);
}

export async function fetchShopHubFrenchCached() {
  const supabase = await createSupabaseServerClient();
  return fetchCmsCatalogSectionResolved(supabase, SHOP_HUB_SECTION_KEYS.french);
}

export async function fetchShopHomeCapsulesFramesCached() {
  const supabase = await createSupabaseServerClient();
  return fetchCmsSectionFramesResolved(supabase, "shop_home_capsules");
}

export async function fetchShopHomeCapsulesDisplayCached() {
  const supabase = await createSupabaseServerClient();
  return fetchCmsSectionPublishedDisplay(supabase, "shop_home_capsules");
}

export async function fetchBoutiqueHubSectionOrderCached() {
  const supabase = await createSupabaseServerClient();
  return fetchBoutiqueHubSectionOrder(supabase);
}
