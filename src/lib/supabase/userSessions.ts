"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";

const toHex = (bytes: Uint8Array) => bytes.reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "");

const encodeBase64 = (value: string) => {
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(value);
  }
  return value;
};

const hashSessionToken = async (token: string) => {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toHex(new Uint8Array(digest));
};

const getStableSessionToken = async (session: Session) => {
  // Compose a stable token source then hash it before storage.
  const raw = `${session.user.id}:${session.access_token}`;
  return hashSessionToken(raw);
};

const rpcUntyped = async (
  supabase: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>,
) =>
  (supabase.rpc as unknown as (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ error?: { message?: string } | null } | undefined>)(fn, args);

const shouldInvalidateAuthSession = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("user from sub claim in jwt does not exist") ||
    normalized.includes("authenticated user does not exist in auth.users")
  );
};

export const upsertSessionLog = async (supabase: SupabaseClient, session: Session) => {
  const sessionToken = await getStableSessionToken(session);
  const response = await rpcUntyped(supabase, "upsert_user_session", {
    p_session_token: sessionToken,
    p_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    p_ip_address: null,
    p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  });

  if (response?.error) {
    const message = response.error.message ?? "Unable to upsert user session";
    if (shouldInvalidateAuthSession(message)) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
    throw new Error(message);
  }

  return sessionToken;
};

export const revokeSessionLog = async (
  supabase: SupabaseClient,
  session: Session | null,
) => {
  if (!session) return;
  const sessionToken = await getStableSessionToken(session);
  const response = await rpcUntyped(supabase, "revoke_user_session", {
    p_session_token: sessionToken,
  });
  if (response?.error) {
    throw new Error(response.error.message ?? "Unable to revoke user session");
  }
};

export const buildSessionCacheKey = (session: Session) =>
  encodeBase64(`${session.user.id}:${session.expires_at ?? "unknown"}`);
