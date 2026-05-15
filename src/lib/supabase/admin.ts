import { createClient } from "@supabase/supabase-js";

import { getClientEnv, getServerEnv } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseAdminClient() {
  const client = tryCreateSupabaseAdminClient();
  if (!client) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin client.");
  }
  return client;
}

/** Client service role pour lectures serveur (cache, jobs). Absent si la clé n’est pas configurée. */
export function tryCreateSupabaseAdminClient() {
  const clientEnv = getClientEnv();
  const serverEnv = getServerEnv();

  if (!serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
