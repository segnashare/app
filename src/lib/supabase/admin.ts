import { createClient } from "@supabase/supabase-js";

import { clientEnv, serverEnv } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseAdminClient() {
  if (!serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin client.");
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
