"use client";

import { useEffect, useMemo, useState } from "react";

import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const APP_DEEP_LINK_BASE = "segna://profile/password";

function readParam(search: URLSearchParams, hash: URLSearchParams, key: string) {
  return search.get(key) || hash.get(key);
}

function buildAppDeepLink() {
  const url = new URL(window.location.href);
  const search = url.searchParams;
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

  const dest = new URL(APP_DEEP_LINK_BASE);
  dest.searchParams.set("recovery", "1");

  const code = readParam(search, hash, "code");
  if (code) dest.searchParams.set("code", code);

  const accessToken = readParam(search, hash, "access_token");
  const refreshToken = readParam(search, hash, "refresh_token");
  if (accessToken && refreshToken) {
    dest.hash = new URLSearchParams({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      type: "recovery",
    }).toString();
  }

  return dest.toString();
}

/**
 * Bridge HTTPS (allowlist Supabase) → app native.
 * `resetPasswordForEmail({ redirectTo: …/auth/mobile-password-reset })`.
 */
export default function MobilePasswordResetBridgePage() {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [browserHref, setBrowserHref] = useState("/auth/reset-password");
  const [showFallback, setShowFallback] = useState(false);
  const montserrat = useMemo(() => segnaMontserrat.className, []);

  useEffect(() => {
    const link = buildAppDeepLink();
    setDeepLink(link);
    setBrowserHref(`/auth/reset-password${window.location.search}${window.location.hash}`);
    const timer = window.setTimeout(() => setShowFallback(true), 1600);
    window.location.replace(link);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-white px-6">
      {!showFallback ? (
        <AuthRingDotSpinner
          variant="onLight"
          dotCount={6}
          filledDots={6}
          spinning
          aria-label="Ouverture de Segna"
        />
      ) : (
        <div className={cn(montserrat, "flex w-full max-w-[360px] flex-col items-center gap-4 text-center")}>
          <p className="text-[17px] font-bold leading-snug text-black">Ouvre Segna pour définir ton mot de passe.</p>
          {deepLink ? (
            <a
              href={deepLink}
              className="flex h-[52px] w-full items-center justify-center rounded-full bg-black text-[16px] font-bold text-white"
            >
              Ouvrir l&apos;app
            </a>
          ) : null}
          <a
            href={browserHref}
            className="text-[14px] font-semibold text-[#666] underline underline-offset-2"
          >
            Continuer dans le navigateur
          </a>
        </div>
      )}
    </main>
  );
}
