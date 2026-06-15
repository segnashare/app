/**
 * Chargeurs boutique (filtres + CMS hub).
 *
 * Filtres : RPC SQL + `unstable_cache` via client service role.
 * CMS hub : RPC en cache (sans URLs) + signature batch via client admin.
 */
import { unstable_cache } from "next/cache";

import { fetchBoutiqueHubSectionOrder } from "@/lib/cms/fetch-boutique-hub-section-order";
import {
  fetchCmsCatalogSectionRaw,
  type CmsCatalogSectionBundle,
} from "@/lib/cms/fetch-cms-catalog-section";
import { fetchCmsSectionFramesRaw } from "@/lib/cms/fetch-cms-section-frames";
import {
  fetchCmsSectionPublishedConfigRaw,
  parseCmsSectionPublishedDisplay,
} from "@/lib/cms/fetch-cms-section-published-config";
import { CMS_SIGNED_URL_TTL_SECONDS, cmsStorageSignClient } from "@/lib/cms/cms-sign-client";
import { collectCmsStoragePaths } from "@/lib/cms/cms-storage-paths";
import { applySignedUrlsToCmsPayload, resolveCmsFrameRowsStorageUrls } from "@/lib/cms/resolve-cms-payload-urls";
import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { SHOP_HUB_SECTION_KEYS, type ShopHubSectionSlug } from "@/lib/cms/shop-hub-sections";
import { enrichShopFilterSizesWithCode } from "@/lib/shop/enrich-shop-filter-sizes";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseDemoAdminClient } from "@/lib/supabase/demo-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSignedUrlsForStoragePaths, type StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";
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

const fetchShopFilterFacetsAdminCached = unstable_cache(fetchShopFilterFacetsAdminUncached, ["shop-boutique-filter-facets-v3"], {
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

async function enrichSizeFacetResponse(
  db: SupabaseClient<Database>,
  sizeRes: ShopFilterFacetQueryResponse,
): Promise<ShopFilterFacetQueryResponse> {
  if (sizeRes.error || sizeRes.data == null) return sizeRes;
  const data = await enrichShopFilterSizesWithCode(db, sizeRes.data);
  return { ...sizeRes, data };
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
      db.from("sizes").select("id,label,code").order("code", { ascending: true }),
      db.from("item_brands").select("id,label").order("label", { ascending: true }),
      db.from("item_couleurs").select("id,label").order("label", { ascending: true }),
      db.from("item_materiaux").select("id,label").order("label", { ascending: true }),
    ]);
    return {
      catResFinal: c,
      sizeResFinal: await enrichSizeFacetResponse(db, s),
      brandResFinal: b,
      colResFinal: col,
      matResFinal: m,
    };
  }

  if (tryCreateSupabaseAdminClient()) {
    try {
      const bundle = await fetchShopFilterFacetsAdminCached();
      const facets = facetResponsesFromBundle(bundle);
      const admin = tryCreateSupabaseAdminClient();
      if (admin) {
        facets.sizeResFinal = await enrichSizeFacetResponse(admin, facets.sizeResFinal);
      }
      return facets;
    } catch {
      /* migration pas encore poussée ou RPC indisponible : repli ci-dessous */
    }
  }

  const { data, error } = await supabaseForRpc.rpc("get_shop_boutique_filter_facets");
  if (!error && data && typeof data === "object" && !Array.isArray(data)) {
    const facets = facetResponsesFromBundle(data as Record<string, unknown>);
    facets.sizeResFinal = await enrichSizeFacetResponse(supabaseForRpc, facets.sizeResFinal);
    return facets;
  }

  const db = await catalogClientForFilters(false);
  const [c, s, b, col, m] = await Promise.all([
    db.from("item_categories").select("id,name,parent_category_id").order("name", { ascending: true }),
    db.from("sizes").select("id,label,code").order("code", { ascending: true }),
    db.from("item_brands").select("id,label").order("label", { ascending: true }),
    db.from("item_couleurs").select("id,label").order("label", { ascending: true }),
    db.from("item_materiaux").select("id,label").order("label", { ascending: true }),
  ]);
  return {
    catResFinal: c,
    sizeResFinal: await enrichSizeFacetResponse(db, s),
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
  return db.from("sizes").select("id,label,code").order("code", { ascending: true });
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

let shopHubSignClientPromise: Promise<StorageSignClient> | null = null;

async function shopHubStorageSignClient(): Promise<StorageSignClient> {
  if (!shopHubSignClientPromise) {
    shopHubSignClientPromise = createSupabaseServerClient().then((client) =>
      cmsStorageSignClient(client as unknown as StorageSignClient),
    );
  }
  return shopHubSignClientPromise;
}

/** Signe les visuels de plusieurs lots de frames CMS en un seul appel Storage. */
export async function resolveShopHubCmsFrameRowsBatch(frameGroups: CmsFrameRow[][]): Promise<CmsFrameRow[][]> {
  const allRows = frameGroups.flat();
  if (allRows.length === 0) return frameGroups.map(() => []);
  const signClient = await shopHubStorageSignClient();
  const paths = [...collectCmsStoragePaths(allRows.map((row) => row.payload))];
  const signedByPath = await createSignedUrlsForStoragePaths(signClient, paths, CMS_SIGNED_URL_TTL_SECONDS);
  return frameGroups.map((rows) =>
    rows.map((row) => ({
      ...row,
      payload: applySignedUrlsToCmsPayload(row.payload, signedByPath),
    })),
  );
}

async function resolveShopHubCatalogSectionsBatch(
  slugs: ShopHubSectionSlug[],
): Promise<Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>>> {
  if (slugs.length === 0) return {};
  const sessionClient = await createSupabaseServerClient();
  const raws = await Promise.all(
    slugs.map(async (slug) => ({
      slug,
      raw: await fetchCmsCatalogSectionRaw(sessionClient as unknown as StorageSignClient, SHOP_HUB_SECTION_KEYS[slug]),
    })),
  );
  const resolvedFrames = await resolveShopHubCmsFrameRowsBatch(raws.map(({ raw }) => raw.frames));
  const out: Partial<Record<ShopHubSectionSlug, CmsCatalogSectionBundle>> = {};
  raws.forEach(({ slug, raw }, index) => {
    out[slug] = { config: raw.config, frames: resolvedFrames[index] ?? [] };
  });
  return out;
}

export async function fetchShopHubDiscoverCached() {
  const sections = await resolveShopHubCatalogSectionsBatch(["discover"]);
  return sections.discover ?? { config: {}, frames: [] };
}

export async function fetchShopHubCategoriesCached() {
  const sections = await resolveShopHubCatalogSectionsBatch(["categories"]);
  return sections.categories ?? { config: {}, frames: [] };
}

export async function fetchShopHubPreferredBrandsCached() {
  const sections = await resolveShopHubCatalogSectionsBatch(["preferredBrands"]);
  return sections.preferredBrands ?? { config: {}, frames: [] };
}

export async function fetchShopHubDealsCached() {
  const sections = await resolveShopHubCatalogSectionsBatch(["deals"]);
  return sections.deals ?? { config: {}, frames: [] };
}

export async function fetchShopHubFrenchCached() {
  const sections = await resolveShopHubCatalogSectionsBatch(["french"]);
  return sections.french ?? { config: {}, frames: [] };
}

/** Charge plusieurs sections hub en parallèle avec signature batch des visuels CMS. */
export async function fetchShopHubSectionsBatchCached(slugs: ShopHubSectionSlug[]) {
  return resolveShopHubCatalogSectionsBatch(slugs);
}

export async function fetchShopHomeCapsulesFramesCached() {
  const signClient = await shopHubStorageSignClient();
  const sessionClient = await createSupabaseServerClient();
  const rows = await fetchCmsSectionFramesRaw(sessionClient as unknown as StorageSignClient, "shop_home_capsules");
  return resolveCmsFrameRowsStorageUrls(rows, signClient);
}

export async function fetchShopHomeCapsulesDisplayCached() {
  const supabase = await createSupabaseServerClient();
  const raw = await fetchCmsSectionPublishedConfigRaw(supabase, "shop_home_capsules");
  return parseCmsSectionPublishedDisplay(raw);
}

export async function fetchBoutiqueHubSectionOrderCached() {
  const supabase = await createSupabaseServerClient();
  return fetchBoutiqueHubSectionOrder(supabase);
}
