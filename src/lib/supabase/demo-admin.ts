import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseDemoAdminClient() {
  const serverEnv = getServerEnv();
  if (!serverEnv.SUPABASE_DEMO_URL || !serverEnv.SUPABASE_DEMO_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient<Database>(
    serverEnv.SUPABASE_DEMO_URL,
    serverEnv.SUPABASE_DEMO_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
