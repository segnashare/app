import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getInstagramConfig, sanitizeReturnPath } from "@/lib/social/instagram";

const STATE_COOKIE_NAME = "segna_instagram_oauth_state";
const RETURN_PATH_COOKIE_NAME = "segna_instagram_oauth_return_path";

export async function GET(request: NextRequest) {
  try {
    const { appId, redirectUri } = getInstagramConfig();
    const returnPath = sanitizeReturnPath(request.nextUrl.searchParams.get("returnPath"), "/profile/complete?tab=me");
    const state = randomUUID();
    const cookieStore = await cookies();

    cookieStore.set(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    cookieStore.set(RETURN_PATH_COOKIE_NAME, returnPath, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });

    const authUrl = new URL("https://api.instagram.com/oauth/authorize");
    authUrl.searchParams.set("client_id", appId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "user_profile,user_media");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);

    return NextResponse.redirect(authUrl);
  } catch (error) {
    const fallback = "/profile/complete?tab=me&instagram=error";
    if (error instanceof Error && error.message.includes("INSTAGRAM_")) {
      return NextResponse.redirect(new URL(`${fallback}&reason=config`, request.url));
    }
    return NextResponse.redirect(new URL(fallback, request.url));
  }
}
