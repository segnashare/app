"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { MEMBER_HOME_HREF } from "@/components/layout/navigation";
import { AuthLandingCollage } from "@/components/auth/AuthLandingCollage";
import { AppPageLoading } from "@/components/ui/AppPageLoading";
import type { AuthCollageFrameRow } from "@/lib/cms/fetch-auth-landing-collage";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { preloadRemoteImages } from "@/lib/ui/preload-remote-images";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

const AUTH_TEASER_MODE = process.env.NEXT_PUBLIC_AUTH_TEASER_MODE === "true";
const LAUNCH_AT_MS = (() => {
  const raw = process.env.NEXT_PUBLIC_LAUNCH_AT?.trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
})();
const APP_STORE_URL = process.env.NEXT_PUBLIC_SEGNA_APP_STORE_URL?.trim() || null;

/** Au-delà de ce délai, on affiche quand même la page (évite blocage infini). */
const COLLAGE_PRELOAD_TIMEOUT_MS = 12_000;
const AUTH_LOGO_SRC = "/ressources/segna_logo.svg";

function uniqueSignedCollageUrls(frames: AuthCollageFrameRow[]): string[] {
  const urls = frames
    .map((row) => row.payload.collage_image?.signed_url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  return [...new Set(urls)];
}

function authVisualUrlsToPreload(frames: AuthCollageFrameRow[]): string[] {
  return [...new Set([...uniqueSignedCollageUrls(frames), AUTH_LOGO_SRC])];
}

type AuthWelcomePageClientProps = {
  initialCollageFrames: AuthCollageFrameRow[];
};

function splitRemainingMs(totalMs: number) {
  const s = Math.floor(totalMs / 1000);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return { days, hours, minutes, seconds };
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function AuthAppStoreCta() {
  return (
    <div className="flex w-full flex-col items-center gap-3 px-4 pb-2">
      <p
        className={cn(
          montserrat.className,
          "text-center text-[13px] font-semibold leading-snug text-zinc-500 md:text-[14px]",
        )}
      >
        Segna est disponible sur iPhone
      </p>
      {APP_STORE_URL ? (
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            montserrat.className,
            themeClassNames.auth.pillCtaTextSize,
            "flex h-[48px] w-full max-w-[280px] items-center justify-center rounded-full bg-zinc-950 font-bold text-white transition-opacity hover:opacity-90 md:h-[52px]",
          )}
        >
          Télécharger sur l&apos;App Store
        </a>
      ) : (
        <p
          className={cn(
            montserrat.className,
            "text-center text-[13px] font-semibold leading-snug text-zinc-400 md:text-[14px]",
          )}
        >
          Bientôt sur l&apos;App Store
        </p>
      )}
    </div>
  );
}

function AuthTeaserCountdown({ launchAtMs }: { launchAtMs: number }) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, launchAtMs - Date.now()));

  useEffect(() => {
    const tick = () => setRemainingMs(Math.max(0, launchAtMs - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [launchAtMs]);

  if (remainingMs <= 0) {
    return <AuthAppStoreCta />;
  }

  const { days, hours, minutes, seconds } = splitRemainingMs(remainingMs);

  return (
    <div className="flex w-full flex-col items-center gap-3 px-2 pb-2 md:px-4">
      <p
        className={cn(
          montserrat.className,
          "text-center text-[13px] font-semibold leading-snug text-zinc-600 md:text-[14px]",
        )}
      >
        Disponible dans
      </p>
      <div
        className={cn(
          montserrat.className,
          "flex w-full items-end justify-center gap-5 sm:gap-7",
        )}
        role="timer"
        aria-live="polite"
        aria-atomic="true"
      >
        {[
          { value: days, label: "JOURS" },
          { value: pad2(hours), label: "HEURES" },
          { value: pad2(minutes), label: "MINUTES" },
          { value: pad2(seconds), label: "SECONDES" },
        ].map((cell) => (
          <div key={cell.label} className="flex flex-col items-center">
            <span className="text-[34px] font-bold tabular-nums leading-none text-zinc-950 sm:text-[40px]">
              {cell.value}
            </span>
            <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 sm:text-[11px]">
              {cell.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AuthWelcomePageClient({ initialCollageFrames }: AuthWelcomePageClientProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isContinuing, setIsContinuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visualsReady, setVisualsReady] = useState(false);

  useEffect(() => {
    const url = window.location.href;
    window.history.replaceState({ noBack: true }, "", url);
    window.history.pushState({ noBack: true }, "", url);
    const blockBack = () => {
      window.history.go(1);
    };
    window.addEventListener("popstate", blockBack);
    return () => {
      window.removeEventListener("popstate", blockBack);
    };
  }, []);

  useEffect(() => {
    const urls = authVisualUrlsToPreload(initialCollageFrames);
    let cancelled = false;
    const t0 = performance.now();

    void (async () => {
      try {
        await preloadRemoteImages(urls, { timeoutMs: COLLAGE_PRELOAD_TIMEOUT_MS });
      } catch {
        /* ignore — afficher la page même si le réseau bloque */
      }
      if (cancelled) return;
      setVisualsReady(true);
      if (process.env.NODE_ENV === "development") {
        console.info("[auth-collage][client] préchargement visuels terminé", {
          imageCount: urls.length,
          ms: Math.round(performance.now() - t0),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialCollageFrames]);

  const handleCommencer = async () => {
    if (isContinuing) return;
    setErrorMessage(null);
    setIsContinuing(true);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setIsContinuing(false);
      router.push("/auth/sign-up/email");
      return;
    }

    setIsContinuing(false);
    router.replace(MEMBER_HOME_HREF);
  };

  const collageFrames = initialCollageFrames;
  const showAuthTeaser = AUTH_TEASER_MODE && LAUNCH_AT_MS !== null;

  if (!visualsReady) {
    return <AppPageLoading label="Chargement" />;
  }

  return (
    <main className="segna-lock-document-scroll relative flex h-dvh min-h-0 flex-col overflow-hidden bg-white">
      {collageFrames.length > 0 ? (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
          <AuthLandingCollage frames={collageFrames} />
        </div>
      ) : null}

      <div className="relative z-10 flex h-dvh min-h-0 min-w-0 flex-col bg-transparent pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
          <p
            className={cn(
              montserrat.className,
              themeClassNames.auth.introHeroBlurb,
              "relative z-20 mx-auto max-w-[min(100%,400px)] px-5 md:px-8",
            )}
          >
            Emprunte, porte, renvoie et recommence
          </p>

          <div className="relative mt-0 min-h-[min(40vh,300px)] w-full min-w-0 flex-1 shrink">
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="relative flex aspect-[497/204] w-[clamp(160px,45vw,250px)] items-center justify-center">
                <img
                  src={AUTH_LOGO_SRC}
                  alt="Segna"
                  width={497}
                  height={204}
                  className="h-full w-full object-contain brightness-0"
                  fetchPriority="high"
                  decoding="async"
                />
              </div>
            </div>
          </div>

          <div
            className={cn(
              "relative z-20 mx-auto mt-auto flex w-full max-w-[min(100%,480px)] shrink-0 flex-col items-center bg-transparent px-2 md:px-4",
              showAuthTeaser || AUTH_TEASER_MODE
                ? "min-h-[180px] justify-center gap-3 pt-2"
                : "gap-3 pt-1",
            )}
          >
            {showAuthTeaser && LAUNCH_AT_MS !== null ? (
              <AuthTeaserCountdown launchAtMs={LAUNCH_AT_MS} />
            ) : AUTH_TEASER_MODE ? (
              <AuthAppStoreCta />
            ) : (
              <>
                <p
                  className={cn(
                    montserrat.className,
                    "w-full max-w-full text-balance text-center text-[11px] font-semibold leading-tight text-zinc-500 md:text-[13px]",
                  )}
                >
                  En créant un compte, tu acceptes les{" "}
                  <Link
                    href="https://www.segnashare.com/conditions-generales-utilisation"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-zinc-700 underline underline-offset-2"
                  >
                    Conditions Générales d&apos;Utilisation
                  </Link>{" "}
                  et notre{" "}
                  <Link
                    href="https://www.segnashare.com/politique-confidentialite"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-zinc-700 underline underline-offset-2"
                  >
                    Politique de confidentialité
                  </Link>
                  .
                </p>

                <button
                  type="button"
                  onClick={() => void handleCommencer()}
                  disabled={isContinuing}
                  className={cn(
                    montserrat.className,
                    themeClassNames.auth.pillCtaTextSize,
                    "flex h-[48px] w-full max-w-[280px] items-center justify-center rounded-full bg-zinc-950 font-bold text-white transition-opacity disabled:opacity-60 md:h-[52px]",
                  )}
                >
                  Commencer
                </button>

                <Link
                  href="/auth/login?from=member"
                  className={cn(
                    montserrat.className,
                    "text-[15px] font-bold text-zinc-950 underline-offset-4 hover:underline md:text-[17px]",
                  )}
                >
                  Je suis membre
                </Link>

                {errorMessage ? (
                  <p className={cn(montserrat.className, "text-center text-[14px] text-[#E44D3E]")}>{errorMessage}</p>
                ) : null}
              </>
            )}
          </div>
        </div>
    </main>
  );
}
