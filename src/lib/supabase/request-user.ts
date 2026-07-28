import { createClient } from "@supabase/supabase-js";

import { getClientEnv } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

function readBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

/**
 * Utilisateur authentifié : cookie session app, ou `Authorization: Bearer <access_token>`
 * (ex. proxy website → checkout Stripe).
 */
export async function resolveRequestUser(request: Request): Promise<{
  user: {
    id: string;
    email?: string | null;
    phone?: string | null;
    phone_confirmed_at?: string | null;
  } | null;
  error: Error | null;
}> {
  const bearer = readBearerToken(request);
  if (bearer) {
    try {
      const env = getClientEnv();
      const supabase = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(bearer);
      if (error || !user) {
        return { user: null, error: error ?? new Error("Session invalide.") };
      }
      return {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          phone_confirmed_at: user.phone_confirmed_at,
        },
        error: null,
      };
    } catch (e) {
      return {
        user: null,
        error: e instanceof Error ? e : new Error("Session invalide."),
      };
    }
  }

  const supabase = (await createSupabaseServerClient()) as any;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { user: null, error: error ?? new Error("Session invalide.") };
  }
  return {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      phone_confirmed_at: user.phone_confirmed_at,
    },
    error: null,
  };
}
