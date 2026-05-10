"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthLandingCollage } from "@/components/auth/AuthLandingCollage";
import type { AuthCollageFrameRow } from "@/lib/cms/fetch-auth-landing-collage";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

/** Au-delà de ce délai, on affiche quand même la page (évite blocage infini). */
const COLLAGE_PRELOAD_TIMEOUT_MS = 12_000;

function uniqueSignedCollageUrls(frames: AuthCollageFrameRow[]): string[] {
  const urls = frames
    .map((row) => row.payload.collage_image?.signed_url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  return [...new Set(urls)];
}

type AuthWelcomePageClientProps = {
  initialCollageFrames: AuthCollageFrameRow[];
};

export function AuthWelcomePageClient({ initialCollageFrames }: AuthWelcomePageClientProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isContinuing, setIsContinuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [collageReady, setCollageReady] = useState(() => initialCollageFrames.length === 0);

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
    if (initialCollageFrames.length === 0) {
      setCollageReady(true);
      return;
    }

    const urls = uniqueSignedCollageUrls(initialCollageFrames);
    if (urls.length === 0) {
      setCollageReady(true);
      return;
    }

    let cancelled = false;
    const t0 = performance.now();

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setCollageReady(true);
        if (process.env.NODE_ENV === "development") {
          console.warn("[auth-collage][client] préchargement collage — timeout", {
            timeoutMs: COLLAGE_PRELOAD_TIMEOUT_MS,
          });
        }
      }
    }, COLLAGE_PRELOAD_TIMEOUT_MS);

    void Promise.all(
      urls.map(
        (href) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = href;
          }),
      ),
    ).then(() => {
      window.clearTimeout(timeoutId);
      if (cancelled) return;
      setCollageReady(true);
      if (process.env.NODE_ENV === "development") {
        console.info("[auth-collage][client] préchargement collage terminé", {
          imageCount: urls.length,
          ms: Math.round(performance.now() - t0),
        });
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
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

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/1",
      p_progress_json: { checkpoint: "/auth" },
      p_request_id: crypto.randomUUID(),
    });
    setIsContinuing(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.replace("/onboarding/1");
  };

  const collageFrames = initialCollageFrames;
  const showCollageLoader = initialCollageFrames.length > 0 && !collageReady;

  return (
    <main
      className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-white"
      aria-busy={showCollageLoader}
    >
      {showCollageLoader ? (
        <div
          className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-white px-6"
          role="status"
          aria-live="polite"
          aria-label="Chargement des visuels"
        >
          <AuthRingDotSpinner variant="onLight" dotCount={6} filledDots={6} spinning aria-label="Chargement" />
          <p className={cn(montserrat.className, "text-center text-[15px] font-semibold text-zinc-500")}>
            Chargement…
          </p>
        </div>
      ) : (
        <>
          {collageFrames.length > 0 ? (
            <div className="pointer-events-none absolute inset-0 z-0 min-h-[100dvh]" aria-hidden>
              <AuthLandingCollage frames={collageFrames} />
            </div>
          ) : null}

          <div className="relative z-10 flex min-h-[100dvh] min-w-0 flex-1 flex-col bg-transparent pb-8 pt-[max(2.5rem,env(safe-area-inset-top))]">
          <p
            className={cn(
              montserrat.className,
              themeClassNames.auth.introHeroBlurb,
              "relative z-20 mx-auto max-w-[min(100%,400px)] px-5 md:px-8",
            )}
          >
            Empruntez, portez, renvoyez et recommencez
          </p>

          <div className="relative mt-0 w-full min-w-0 flex-1 shrink-0 min-h-[min(52vh,420px)]">
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="relative flex aspect-[497/204] w-[clamp(180px,50vw,280px)] items-center justify-center">
                <img
                  src="/ressources/segna_logo.svg"
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

          <div className="relative z-20 mx-auto mt-auto flex w-full max-w-[min(100%,480px)] flex-col items-center gap-5 bg-transparent px-2 pt-2 md:px-4">
            <p
              className={cn(
                montserrat.className,
                "w-full max-w-full text-balance text-center text-[12px] font-semibold leading-snug text-zinc-500 md:text-[13px]",
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
                "flex h-[52px] w-full max-w-[280px] items-center justify-center rounded-full bg-zinc-950 font-bold text-white transition-opacity disabled:opacity-60",
              )}
            >
              Commencer
            </button>

            <Link
              href="/auth/login?from=member"
              className={cn(
                montserrat.className,
                "text-[16px] font-bold text-zinc-950 underline-offset-4 hover:underline md:text-[17px]",
              )}
            >
              Je suis membre
            </Link>

            {errorMessage ? (
              <p className={cn(montserrat.className, "text-center text-[14px] text-[#E44D3E]")}>{errorMessage}</p>
            ) : null}
          </div>
        </div>
        </>
      )}
    </main>
  );
}
