export type InstagramConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
};

export type InstagramProfile = {
  id: string;
  username: string;
  account_type?: string;
  media_count?: number;
};

export type InstagramMediaItem = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
};

type OAuthTokenResponse = {
  access_token?: string;
  user_id?: number | string;
  error_type?: string;
  code?: number;
  error_message?: string;
};

type LongLivedTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

function getBaseAppUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv && /^https?:\/\//.test(fromEnv)) return fromEnv.replace(/\/+$/, "");

  const fromVercel = process.env.VERCEL_URL?.trim();
  if (fromVercel) return `https://${fromVercel.replace(/\/+$/, "")}`;

  return "";
}

export function getInstagramConfig(): InstagramConfig {
  const appId = process.env.INSTAGRAM_APP_ID?.trim() ?? "";
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim() ?? "";
  const baseUrl = getBaseAppUrl();
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI?.trim() || (baseUrl ? `${baseUrl}/api/social/instagram/callback` : "");

  if (!appId) throw new Error("INSTAGRAM_APP_ID is missing.");
  if (!appSecret) throw new Error("INSTAGRAM_APP_SECRET is missing.");
  if (!redirectUri || !/^https?:\/\//.test(redirectUri)) {
    throw new Error("INSTAGRAM_REDIRECT_URI is missing or invalid.");
  }

  return { appId, appSecret, redirectUri };
}

export function sanitizeReturnPath(value: string | null | undefined, fallbackPath: string): string {
  if (!value) return fallbackPath;
  if (!value.startsWith("/")) return fallbackPath;
  if (value.startsWith("//")) return fallbackPath;
  return value;
}

export function appendQueryParam(path: string, key: string, value: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export async function exchangeCodeForAccessToken(params: {
  code: string;
  config: InstagramConfig;
}): Promise<{ accessToken: string; userId: string; expiresIn: number | null }> {
  const formBody = new URLSearchParams({
    client_id: params.config.appId,
    client_secret: params.config.appSecret,
    grant_type: "authorization_code",
    redirect_uri: params.config.redirectUri,
    code: params.code,
  });

  const shortTokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody.toString(),
    cache: "no-store",
  });

  const shortTokenData = (await shortTokenResponse.json()) as OAuthTokenResponse;
  const shortLivedAccessToken = shortTokenData.access_token?.trim() ?? "";
  const userId = String(shortTokenData.user_id ?? "").trim();

  if (!shortTokenResponse.ok || !shortLivedAccessToken || !userId) {
    const errorMessage = shortTokenData.error_message || "Instagram token exchange failed.";
    throw new Error(errorMessage);
  }

  const longTokenUrl = new URL("https://graph.instagram.com/access_token");
  longTokenUrl.searchParams.set("grant_type", "ig_exchange_token");
  longTokenUrl.searchParams.set("client_secret", params.config.appSecret);
  longTokenUrl.searchParams.set("access_token", shortLivedAccessToken);

  const longTokenResponse = await fetch(longTokenUrl, { cache: "no-store" });
  const longTokenData = (await longTokenResponse.json()) as LongLivedTokenResponse;

  if (!longTokenResponse.ok || !longTokenData.access_token) {
    // Keep MVP resilient: fallback to short-lived token when exchange fails.
    return { accessToken: shortLivedAccessToken, userId, expiresIn: null };
  }

  return {
    accessToken: longTokenData.access_token,
    userId,
    expiresIn: typeof longTokenData.expires_in === "number" ? longTokenData.expires_in : null,
  };
}

export async function fetchInstagramProfile(accessToken: string): Promise<InstagramProfile> {
  const meUrl = new URL("https://graph.instagram.com/me");
  meUrl.searchParams.set("fields", "id,username,account_type,media_count");
  meUrl.searchParams.set("access_token", accessToken);

  const response = await fetch(meUrl, { cache: "no-store" });
  const data = (await response.json()) as InstagramProfile & {
    error?: { message?: string };
  };

  if (!response.ok || !data.id || !data.username) {
    throw new Error(data.error?.message || "Unable to read Instagram profile.");
  }

  return data;
}

export async function fetchInstagramMedia(accessToken: string, limit = 6): Promise<InstagramMediaItem[]> {
  const mediaUrl = new URL("https://graph.instagram.com/me/media");
  mediaUrl.searchParams.set("fields", "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp");
  mediaUrl.searchParams.set("limit", String(limit));
  mediaUrl.searchParams.set("access_token", accessToken);

  const response = await fetch(mediaUrl, { cache: "no-store" });
  const data = (await response.json()) as {
    data?: InstagramMediaItem[];
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(data.error?.message || "Unable to read Instagram media.");
  }

  return Array.isArray(data.data) ? data.data : [];
}
