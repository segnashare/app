import { NextResponse, type NextRequest } from "next/server";

import { REFERRAL_COOKIE_NAME } from "@/lib/referral/referralInviteConstants";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type OAuthIntent = "signup" | "member";
type OAuthErrorCode = "provider_error" | "missing_code" | "exchange_failed" | "missing_user" | "bootstrap_failed";

function normalizeIntent(value: string | null): OAuthIntent {
  return value === "member" ? "member" : "signup";
}

function redirectWithOAuthError(request: NextRequest, intent: OAuthIntent, errorCode: OAuthErrorCode) {
  const url = request.nextUrl.clone();
  url.pathname = intent === "member" ? "/auth/login" : "/auth/sign-up/email";
  url.search = "";
  if (intent === "member") {
    url.searchParams.set("from", "member");
  }
  url.searchParams.set("oauth_error", errorCode);
  return NextResponse.redirect(url);
}

function referralCodeFromCookie(request: NextRequest): string | null {
  const raw = request.cookies.get(REFERRAL_COOKIE_NAME)?.value;
  if (!raw || !raw.trim()) return null;
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return raw.trim() || null;
  }
}

async function resolvePostAuthPath(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
) {
  const { data: onboardingData } = await supabase
    .from("onboarding_sessions")
    .select("current_step, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (onboardingData?.status === "completed") return "/shop";
  if (onboardingData?.current_step?.startsWith("/onboarding/")) return onboardingData.current_step;

  const { data: profileRow } = await supabase
    .from("user_profiles")
    .select("score, profile_data")
    .eq("user_id", userId)
    .maybeSingle();
  const profileData = (profileRow?.profile_data ?? {}) as Record<string, unknown>;
  const rawScore =
    profileRow?.score ??
    profileData.completion_score ??
    profileData.profile_completion ??
    profileData.score ??
    profileData.progress_score;
  const numericScore = typeof rawScore === "number" ? rawScore : Number(rawScore);
  if (Number.isFinite(numericScore) && numericScore >= 100) return "/shop";

  return "/onboarding/1";
}

export async function GET(request: NextRequest) {
  const intent = normalizeIntent(request.nextUrl.searchParams.get("intent"));

  if (request.nextUrl.searchParams.has("error")) {
    return redirectWithOAuthError(request, intent, "provider_error");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectWithOAuthError(request, intent, "missing_code");
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return redirectWithOAuthError(request, intent, "exchange_failed");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return redirectWithOAuthError(request, intent, "missing_user");
  }

  const rpcUntyped = (fn: string, args?: Record<string, unknown>) =>
    (supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data?: unknown; error?: { message?: string } | null }>)(fn, args);

  const referralFromCookie = referralCodeFromCookie(request);

  const bootstrapResult = await rpcUntyped("bootstrap_user_after_signup", {
    p_first_name: null,
    p_last_name: null,
    p_locale: null,
    p_timezone: null,
    p_request_id: crypto.randomUUID(),
    p_referral_code: referralFromCookie,
  });

  if (bootstrapResult.error) {
    await supabase.auth.signOut();
    return redirectWithOAuthError(request, intent, "bootstrap_failed");
  }

  const url = request.nextUrl.clone();
  url.pathname = await resolvePostAuthPath(supabase, user.id);
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.set(REFERRAL_COOKIE_NAME, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}
