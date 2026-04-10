import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getClientEnv } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Une seule instance côté navigateur : plusieurs `createBrowserClient` créent chacun un client GoTrue
 * qui se disputent le même verrou async sur le token (erreurs AbortError / « steal » en dev, Strict Mode).
 */
let browserClient: SupabaseClient<Database> | undefined;

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const clientEnv = getClientEnv();
  if (typeof window === "undefined") {
    return createBrowserClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_KEY);
  }
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_KEY);
  }
  return browserClient;
}

export function isSupabaseAuthLockAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return error.message.includes("Lock broken") && error.message.includes("steal");
}

function isAuthLockMessage(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return m.includes("lock broken") || m.includes("steal");
}

/**
 * GoTrue sérialise l’accès au token via un verrou async : en dev (Strict Mode) plusieurs
 * `getUser()` simultanés déclenchent AbortError / « steal ». On réessaie avec un léger backoff.
 */
export async function getBrowserAuthUser(supabase: SupabaseClient<Database>) {
  const maxAttempts = 5;
  const baseDelayMs = 45;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await supabase.auth.getUser();
      if (result.error && isAuthLockMessage(result.error.message) && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs + attempt * 55));
        continue;
      }
      return result;
    } catch (e) {
      if (isSupabaseAuthLockAbortError(e) && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs + attempt * 55));
        continue;
      }
      throw e;
    }
  }
  return supabase.auth.getUser();
}
