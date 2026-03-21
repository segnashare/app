import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  appendQueryParam,
  exchangeCodeForAccessToken,
  fetchInstagramProfile,
  getInstagramConfig,
  sanitizeReturnPath,
} from "@/lib/social/instagram";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATE_COOKIE_NAME = "segna_instagram_oauth_state";
const RETURN_PATH_COOKIE_NAME = "segna_instagram_oauth_return_path";

type SupabaseRpcResult = {
  error?: { message?: string } | null;
};

type SupabaseCallbackClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<SupabaseRpcResult>;
};

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE_NAME)?.value;
  const returnPath = sanitizeReturnPath(cookieStore.get(RETURN_PATH_COOKIE_NAME)?.value, "/profile/complete?tab=me");

  cookieStore.delete(STATE_COOKIE_NAME);
  cookieStore.delete(RETURN_PATH_COOKIE_NAME);

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectTo(request, appendQueryParam(returnPath, "instagram", "oauth_state_error"));
  }

  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseCallbackClient;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return redirectTo(request, appendQueryParam("/auth/start", "next", returnPath));
    }

    const config = getInstagramConfig();
    const tokenData = await exchangeCodeForAccessToken({ code, config });
    const profile = await fetchInstagramProfile(tokenData.accessToken);
    const expiresAt =
      typeof tokenData.expiresIn === "number" ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString() : null;

    const { error: updateError } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        profile_data: {
          instagram: {
            connected: true,
            provider_user_id: profile.id,
            username: profile.username,
            account_type: profile.account_type ?? null,
            media_count: typeof profile.media_count === "number" ? profile.media_count : null,
            access_token: tokenData.accessToken,
            token_expires_at: expiresAt,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      },
      p_request_id: crypto.randomUUID(),
    });

    if (updateError) {
      return redirectTo(request, appendQueryParam(returnPath, "instagram", "save_error"));
    }

    return redirectTo(request, appendQueryParam(returnPath, "instagram", "connected"));
  } catch {
    return redirectTo(request, appendQueryParam(returnPath, "instagram", "oauth_error"));
  }
}
