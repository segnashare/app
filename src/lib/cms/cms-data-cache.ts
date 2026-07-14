/**
 * Cache Next.js des lectures CMS (RPC sans URLs signées).
 * Les visuels sont signés à la demande via client admin (voir cms-sign-client).
 */
import { unstable_cache } from "next/cache";

import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function adminRpcClient(): RpcClient | null {
  return tryCreateSupabaseAdminClient() as RpcClient | null;
}

async function fetchCmsCatalogSectionRawUncached(sectionKey: string): Promise<unknown> {
  const client = adminRpcClient();
  if (!client) return null;
  const { data, error } = await client.rpc("get_cms_catalog_section", { p_section_key: sectionKey });
  if (error) throw new Error(error.message ?? "get_cms_catalog_section failed");
  return data;
}

async function fetchCmsSectionFramesRawUncached(sectionKey: string): Promise<unknown> {
  const client = adminRpcClient();
  if (!client) return null;
  const { data, error } = await client.rpc("get_cms_section_frames", { p_section_key: sectionKey });
  if (error) throw new Error(error.message ?? "get_cms_section_frames failed");
  return data;
}

async function fetchCmsSectionPublishedConfigRawUncached(sectionKey: string): Promise<unknown> {
  const client = adminRpcClient();
  if (!client) return null;
  const { data, error } = await client.rpc("get_cms_section_published_config", {
    p_section_key: sectionKey,
  });
  if (error) throw new Error(error.message ?? "get_cms_section_published_config failed");
  return data;
}

async function fetchBoutiqueHubSectionOrderRawUncached(): Promise<unknown> {
  const client = adminRpcClient();
  if (!client) return null;
  const { data, error } = await client.rpc("get_cms_boutique_section_order");
  if (error) throw new Error(error.message ?? "get_cms_boutique_section_order failed");
  return data;
}

async function fetchEchangeSectionOrderRawUncached(): Promise<unknown> {
  const client = adminRpcClient();
  if (!client) return null;
  const { data, error } = await client.rpc("get_cms_echange_section_order");
  if (error) throw new Error(error.message ?? "get_cms_echange_section_order failed");
  return data;
}

const CMS_CACHE_REVALIDATE_SECONDS = 120;

function cachedCmsFetch<T>(key: string, tag: string, loader: () => Promise<T>): Promise<T> {
  const cached = unstable_cache(loader, [key], {
    revalidate: CMS_CACHE_REVALIDATE_SECONDS,
    tags: [tag],
  });
  return cached();
}

export function fetchCmsCatalogSectionRawCached(sectionKey: string): Promise<unknown> {
  return cachedCmsFetch(
    `cms-catalog-section-v1-${sectionKey}`,
    `cms-catalog-section-${sectionKey}`,
    () => fetchCmsCatalogSectionRawUncached(sectionKey),
  );
}

export function fetchCmsSectionFramesRawCached(sectionKey: string): Promise<unknown> {
  return cachedCmsFetch(
    `cms-section-frames-v1-${sectionKey}`,
    `cms-section-frames-${sectionKey}`,
    () => fetchCmsSectionFramesRawUncached(sectionKey),
  );
}

export function fetchCmsSectionPublishedConfigRawCached(sectionKey: string): Promise<unknown> {
  return cachedCmsFetch(
    `cms-section-config-v1-${sectionKey}`,
    `cms-section-config-${sectionKey}`,
    () => fetchCmsSectionPublishedConfigRawUncached(sectionKey),
  );
}

export function fetchBoutiqueHubSectionOrderRawCached(): Promise<unknown> {
  return cachedCmsFetch("cms-boutique-order-v2", "cms-boutique-order", fetchBoutiqueHubSectionOrderRawUncached);
}

export function fetchEchangeSectionOrderRawCached(): Promise<unknown> {
  return cachedCmsFetch("cms-echange-order-v1", "cms-echange-order", fetchEchangeSectionOrderRawUncached);
}
