import type { CmsFrameRow } from "@/lib/cms/cms-types";
import { fetchCmsSectionFramesRaw } from "@/lib/cms/fetch-cms-section-frames";
import {
  fetchCmsSectionPublishedConfigRaw,
  parseCmsSectionPublishedDisplay,
  type CmsSectionPublishedDisplay,
} from "@/lib/cms/fetch-cms-section-published-config";
import { resolveCmsFrameRowGroupsStorageUrlsBatch } from "@/lib/cms/resolve-cms-payload-urls";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

export type ExchangeCmsSectionBundle = {
  frames: CmsFrameRow[];
  display: CmsSectionPublishedDisplay;
};

/**
 * Charge plusieurs sections CMS Échange en parallèle, avec signature batch des visuels.
 */
export async function loadExchangeCmsSections(
  supabase: StorageSignClient,
  sectionKeys: string[],
): Promise<Record<string, ExchangeCmsSectionBundle>> {
  const uniqueKeys = [...new Set(sectionKeys.filter(Boolean))];
  if (uniqueKeys.length === 0) return {};

  const [rawFramesList, rawConfigs] = await Promise.all([
    Promise.all(uniqueKeys.map((key) => fetchCmsSectionFramesRaw(supabase, key))),
    Promise.all(
      uniqueKeys.map((key) =>
        fetchCmsSectionPublishedConfigRaw(
          supabase as unknown as {
            rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<unknown>;
          },
          key,
        ),
      ),
    ),
  ]);

  const resolvedFramesList = await resolveCmsFrameRowGroupsStorageUrlsBatch(rawFramesList);

  const out: Record<string, ExchangeCmsSectionBundle> = {};
  uniqueKeys.forEach((key, index) => {
    out[key] = {
      frames: resolvedFramesList[index] ?? [],
      display: parseCmsSectionPublishedDisplay(rawConfigs[index]),
    };
  });
  return out;
}
