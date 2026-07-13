import {
  fetchCmsCatalogSectionResolved,
  type CmsCatalogSectionBundle,
} from "@/lib/cms/fetch-cms-catalog-section";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

/**
 * Charge plusieurs sections CMS Accueil en parallèle (config publiée + frames signées).
 */
export async function loadHomeCmsSections(
  supabase: StorageSignClient,
  sectionKeys: string[],
): Promise<Record<string, CmsCatalogSectionBundle>> {
  const uniqueKeys = [...new Set(sectionKeys.filter(Boolean))];
  if (uniqueKeys.length === 0) return {};

  const entries = await Promise.all(
    uniqueKeys.map(async (key) => {
      const bundle = await fetchCmsCatalogSectionResolved(supabase, key);
      return [key, bundle] as const;
    }),
  );

  return Object.fromEntries(entries);
}
