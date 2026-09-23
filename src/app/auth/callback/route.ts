import { NextResponse, type NextRequest } from "next/server";

import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { flushServerAnalytics, trackServerEvent } from "@/lib/analytics/track-server";
import { getWebsiteOrigin } from "@/lib/auth/website-checkout-onboarding";
import { isAllowedWebsiteReturnTo } from "@/lib/auth/website-return-to";
import { REFERRAL_COOKIE_NAME } from "@/lib/referral/referralInviteConstants";
import { MEMBER_HOME_HREF } from "@/components/layout/navigation";
import { declareUserRegisteredToN8n } from "@/lib/notifications/notify-ops-activity-n8n";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type OAuthIntent = "signup" | "member";
type OAuthErrorCode = "provider_error" | "missing_code" | "exchange_failed" | "missing_user" | "bootstrap_failed";

function normalizeIntent(value: string | null): OAuthIntent {
  return value === "member" ? "member" : "signup";
}

function redirectWithOAuthError(
  request: NextRequest,
  intent: OAuthIntent,
  errorCode: OAuthErrorCode,
  returnTo: string | null,
) {
  if (returnTo && isAllowedWebsiteReturnTo(returnTo)) {
    const target = new URL(returnTo);
    target.searchParams.set("auth_error", errorCode);
    target.searchParams.set("checkout", "1");
    return NextResponse.redirect(target);
  }

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
): Promise<string> {
  // OAuth app-native (pas de return_to website) : rester dans le funnel app.
  // Un compte tout neuf a current_step `/onboarding/1`, qui n'est pas « past website »
  // — l'ancien check envoyait à tort vers le tunnel site (OTP téléphone).
  const { data: onboardingData } = await supabase
    .from("onboarding_sessions")
    .select("current_step, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (onboardingData?.status === "completed") return MEMBER_HOME_HREF;
  if (onboardingData?.current_step?.startsWith("/onboarding/")) {
    return onboardingData.current_step;
  }

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
  if (Number.isFinite(numericScore) && numericScore >= 100) {
    return MEMBER_HOME_HREF;
  }

  return "/onboarding/1";
}

/** Handoff session app → website (hash, lu côté client website). */
function redirectToWebsiteWithSession(
  returnTo: string,
  accessToken: string,
  refreshToken: string,
  type = "website_oauth",
) {
  const target = new URL(returnTo);
  const hash = new URLSearchParams({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    type,
  });
  target.hash = hash.toString();
  const res = NextResponse.redirect(target);
  res.cookies.set(REFERRAL_COOKIE_NAME, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}

export async function GET(request: NextRequest) {
  const intent = normalizeIntent(request.nextUrl.searchParams.get("intent"));
  const returnToRaw = request.nextUrl.searchParams.get("return_to");
  const returnTo = returnToRaw && isAllowedWebsiteReturnTo(returnToRaw) ? returnToRaw.trim() : null;
  const authType = request.nextUrl.searchParams.get("type");

  if (request.nextUrl.searchParams.has("error")) {
    return redirectWithOAuthError(request, intent, "provider_error", returnTo);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectWithOAuthError(request, intent, "missing_code", returnTo);
  }

  const supabase = await createSupabaseServerClient();
  const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return redirectWithOAuthError(request, intent, "exchange_failed", returnTo);
  }

  // Recovery PKCE : renvoyer vers le bridge app (deep link iOS), pas le website.
  if (authType === "recovery") {
    const target = new URL("/auth/mobile-password-reset", request.nextUrl.origin);
    const accessToken = exchangeData.session?.access_token;
    const refreshToken = exchangeData.session?.refresh_token;
    if (accessToken && refreshToken) {
      target.hash = new URLSearchParams({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "bearer",
        type: "recovery",
      }).toString();
    }
    return NextResponse.redirect(target);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return redirectWithOAuthError(request, intent, "missing_user", returnTo);
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
    return redirectWithOAuthError(request, intent, "bootstrap_failed", returnTo);
  }

  // Apple / Google : l'email est déjà vérifié par le provider. Discord maintenant, pas au téléphone.
  const provider = user.app_metadata?.provider;
  try {
    await declareUserRegisteredToN8n(createSupabaseAdminClient(), {
      userId: user.id,
      source: typeof provider === "string" ? `oauth:${provider}` : "oauth",
    });
  } catch (err) {
    console.error("[auth/callback] user_registered n8n", err);
  }

  const createdAtMs = user.created_at ? Date.parse(user.created_at) : Number.NaN;
  const isNewAccount =
    intent === "signup" && Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 5 * 60 * 1000;
  if (isNewAccount) {
    trackServerEvent(
      ANALYTICS_EVENTS.userSignedUp,
      { distinctId: user.id, insertId: `user_signed_up:${user.id}` },
      {
        method: "oauth",
        referral_code_present: Boolean(referralFromCookie),
        provider: typeof provider === "string" ? provider : undefined,
      },
    );
    await flushServerAnalytics();
  }

  if (returnTo) {
    const accessToken = exchangeData.session?.access_token;
    const refreshToken = exchangeData.session?.refresh_token;
    if (accessToken && refreshToken) {
      return redirectToWebsiteWithSession(returnTo, accessToken, refreshToken);
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.access_token && sessionData.session.refresh_token) {
      return redirectToWebsiteWithSession(
        returnTo,
        sessionData.session.access_token,
        sessionData.session.refresh_token,
      );
    }
    return redirectWithOAuthError(request, intent, "exchange_failed", returnTo);
  }

  const destination = await resolvePostAuthPath(supabase, user.id);
  const url = request.nextUrl.clone();
  url.pathname = destination;
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.set(REFERRAL_COOKIE_NAME, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}
