"use client";

import { useEffect } from "react";

import { getWebsiteOrigin } from "@/lib/auth/website-checkout-onboarding";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function forwardRecoverySessionToWebsite(accessToken: string, refreshToken: string) {
  const target = new URL("/reset-password", getWebsiteOrigin());
  target.hash = new URLSearchParams({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    type: "recovery",
  }).toString();
  window.location.replace(target.toString());
}

/**
 * Si un reset website n’est pas dans la allowlist Supabase, le lien tombe sur le
 * Site URL (= app, souvent `/`). On renvoie alors vers le website.
 * Les resets initiés depuis l’app (`/auth/reset-password`) restent sur l’app.
 */
export function PasswordRecoveryWebsiteBridge() {
  useEffect(() => {
    const path = window.location.pathname;
    const onAppResetPage = path.startsWith("/auth/reset-password");

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const queryType = new URLSearchParams(window.location.search).get("type");
    const hashType = hashParams.get("type");
    const accessFromHash = hashParams.get("access_token");
    const refreshFromHash = hashParams.get("refresh_token");
    const isRecoveryLink = hashType === "recovery" || queryType === "recovery";

    if (!onAppResetPage && isRecoveryLink && accessFromHash && refreshFromHash) {
      forwardRecoverySessionToWebsite(accessFromHash, refreshFromHash);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "PASSWORD_RECOVERY") return;
      if (!session?.access_token || !session.refresh_token) return;
      // Reset app natif : ne pas détourner.
      if (window.location.pathname.startsWith("/auth/reset-password")) return;
      forwardRecoverySessionToWebsite(session.access_token, session.refresh_token);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}
