import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SESSION_IDLE_COOKIE = "segna_last_seen_at";
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const PUBLIC_PREFIXES = [
  "/",
  "/auth/login",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/sign-up/email",
  "/auth/sign-up/verify",
];

const PROTECTED_PREFIXES = [
  "/onboarding",
  "/auth/sign-up/password",
  "/home",
  "/shop",
  "/cart",
  "/exchange",
  "/community",
  "/profile",
  "/items",
  "/membre",
];
const ONBOARDING_PATHS = [
  "/onboarding/1",
  "/onboarding/phone",
  "/onboarding/phone/verify",
  "/onboarding/name",
  "/onboarding/2",
  "/onboarding/birth",
  "/onboarding/size",
  "/onboarding/3",
  "/onboarding/end",
] as const;

/** Ancien `current_step` ou URL : ramène au canonique utilisé pour l’index du parcours. */
const LEGACY_ONBOARDING_STEP: Record<string, (typeof ONBOARDING_PATHS)[number]> = {
  "/onboarding/privacy": "/onboarding/3",
};

type OnboardingPath = (typeof ONBOARDING_PATHS)[number];

const ONBOARDING_ALIASES: Record<string, OnboardingPath> = {
  "/onboarding": "/onboarding/1",
  "/onboarding/confidentiality": "/onboarding/3",
  "/onboarding/confidentialite": "/onboarding/3",
  "/onboarding/interests": "/onboarding/3",
};

function normalizeOnboardingPath(pathname: string): OnboardingPath | null {
  const legacy = LEGACY_ONBOARDING_STEP[pathname];
  if (legacy) return legacy;
  if ((ONBOARDING_PATHS as readonly string[]).includes(pathname)) {
    return pathname as OnboardingPath;
  }
  return ONBOARDING_ALIASES[pathname] ?? null;
}

function getOnboardingIndexFromPath(pathname: string) {
  const normalizedPath = normalizeOnboardingPath(pathname);
  if (!normalizedPath) return -1;
  return ONBOARDING_PATHS.findIndex((path) => path === normalizedPath);
}

function getOnboardingPathFromIndex(index: number) {
  const clamped = Math.max(0, Math.min(index, ONBOARDING_PATHS.length - 1));
  return ONBOARDING_PATHS[clamped];
}

function isAllowedOnboardingJump(_requestedPath: string, _reachedPath: string) {
  return false;
}

function getReachedOnboardingIndex(currentStep: string | null) {
  const normalizedStep = normalizeOnboardingPath(currentStep ?? "");
  if (!normalizedStep) return 0;

  const index = ONBOARDING_PATHS.findIndex((path) => path === normalizedStep);
  return index === -1 ? 0 : index;
}

function isPublicRoute(pathname: string) {
  return PUBLIC_PREFIXES.some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname.startsWith(prefix),
  );
}

function isProtectedRoute(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Lets returning members open sign-in even with an active session (switch account / re-auth). */
function isExplicitMemberSignIn(request: NextRequest) {
  return (
    request.nextUrl.pathname === "/auth/login" && request.nextUrl.searchParams.get("from") === "member"
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = request.nextUrl;
  const now = Date.now();
  const lastSeenRaw = request.cookies.get(SESSION_IDLE_COOKIE)?.value;
  const lastSeen = lastSeenRaw ? Number(lastSeenRaw) : Number.NaN;

  if (session?.user && Number.isFinite(lastSeen) && now - lastSeen > SESSION_IDLE_TIMEOUT_MS) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("expired", "1");

    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    redirectResponse.cookies.delete(SESSION_IDLE_COOKIE);
    return redirectResponse;
  }

  if (session?.user) {
    response.cookies.set(SESSION_IDLE_COOKIE, String(now), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: Math.floor(SESSION_IDLE_TIMEOUT_MS / 1000),
    });
  } else if (request.cookies.get(SESSION_IDLE_COOKIE)) {
    response.cookies.delete(SESSION_IDLE_COOKIE);
  }

  if (session?.user) {
    console.info("[middleware][auth] Connected user on request", {
      userId: session.user.id,
      email: session.user.email ?? null,
      pathname,
    });
  }
  const hasVerifyParams = request.nextUrl.searchParams.has("email") && request.nextUrl.searchParams.has("sentAt");

  if (!session && pathname === "/auth/sign-up/verify" && !hasVerifyParams) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-up/email";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isProtectedRoute(pathname) && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  let cachedReachedIndex: number | null = null;
  let cachedReachedPath: OnboardingPath | undefined;
  let cachedStatus: string | null | undefined;
  const getReachedState = async () => {
    if (!session) {
      return {
        reachedIndex: 0,
        reachedPath: ONBOARDING_PATHS[0],
        status: null as string | null,
      };
    }
    if (cachedReachedIndex !== null && cachedReachedPath !== undefined && cachedStatus !== undefined) {
      return { reachedIndex: cachedReachedIndex, reachedPath: cachedReachedPath, status: cachedStatus };
    }

    const { data } = await supabase
      .from("onboarding_sessions")
      .select("current_step, status")
      .eq("user_id", session.user.id)
      .maybeSingle();

    const reachedPath = normalizeOnboardingPath(data?.current_step ?? "") ?? ONBOARDING_PATHS[0];
    cachedReachedPath = reachedPath;
    cachedReachedIndex = getReachedOnboardingIndex(reachedPath);
    cachedStatus = data?.status ?? null;
    return { reachedIndex: cachedReachedIndex, reachedPath: cachedReachedPath, status: cachedStatus };
  };

  if (session && pathname.startsWith("/auth/sign-up/password")) {
    const { reachedIndex, status } = await getReachedState();
    if (status === "completed") {
      const url = request.nextUrl.clone();
      url.pathname = "/home";
      return NextResponse.redirect(url);
    }
    if (reachedIndex > 0) {
      const url = request.nextUrl.clone();
      url.pathname = getOnboardingPathFromIndex(reachedIndex);
      return NextResponse.redirect(url);
    }
  }

  if (session && pathname.startsWith("/onboarding")) {
    const { reachedIndex, reachedPath, status } = await getReachedState();
    if (status === "completed") {
      const url = request.nextUrl.clone();
      url.pathname = "/home";
      return NextResponse.redirect(url);
    }
    if (pathname === "/onboarding") {
      const url = request.nextUrl.clone();
      url.pathname = getOnboardingPathFromIndex(reachedIndex);
      return NextResponse.redirect(url);
    }
    const requestedIndex = getOnboardingIndexFromPath(pathname);
    if (requestedIndex === -1) {
      const url = request.nextUrl.clone();
      url.pathname = getOnboardingPathFromIndex(reachedIndex);
      return NextResponse.redirect(url);
    }
    if (requestedIndex > reachedIndex && !isAllowedOnboardingJump(pathname, reachedPath)) {
      const url = request.nextUrl.clone();
      url.pathname = getOnboardingPathFromIndex(reachedIndex);
      return NextResponse.redirect(url);
    }
  }

  if (session && isPublicRoute(pathname) && pathname !== "/" && !isExplicitMemberSignIn(request)) {
    const { reachedIndex, status } = await getReachedState();
    const url = request.nextUrl.clone();
    url.pathname = status === "completed" ? "/home" : getOnboardingPathFromIndex(reachedIndex);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
