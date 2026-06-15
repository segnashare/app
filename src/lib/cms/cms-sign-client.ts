import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import type { StorageSignClient } from "@/lib/supabase/storage-resolve-signed-url";

/** Client service role pour signer les visuels CMS (bucket_cms_app) — indépendant de la session. */
export function cmsStorageSignClient(fallback?: StorageSignClient): StorageSignClient {
  return (tryCreateSupabaseAdminClient() ?? fallback) as StorageSignClient;
}

/** TTL URLs signées CMS (24 h — aligné couvertures catalogue). */
export const CMS_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;
