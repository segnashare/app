import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_KEY,
  );
}
