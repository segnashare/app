"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { MEMBER_HOME_HREF } from "@/components/layout/navigation";
import {
  isWebsiteCheckoutTunnelComplete,
  websiteOnboardingResumeUrl,
} from "@/lib/auth/website-checkout-onboarding";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const HANDOFF_TYPE_KEY = "segna_website_handoff_type";

/**
 * Handoff website → app : lit les tokens dans le hash, pose la session,
 * puis redirige vers l’accueil / onboarding app — ou renvoie au site
 * si le tunnel website (nom / adresse / …) n’est pas terminé.
 *
 * Persiste `type` en sessionStorage : React Strict Mode peut remonter l’effet
 * après `replaceState` (hash vidé) et sinon on perdait `website_activate_segnax`.
 */
export default function AuthHandoffPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Connexion en cours…");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash;
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const typeFromHash = params.get("type")?.trim() ?? "";
        if (typeFromHash) {
          try {
            sessionStorage.setItem(HANDOFF_TYPE_KEY, typeFromHash);
          } catch {
            // ignore
          }
        }
        let handoffType = typeFromHash;
        if (!handoffType) {
          try {
            handoffType = sessionStorage.getItem(HANDOFF_TYPE_KEY)?.trim() ?? "";
          } catch {
            handoffType = "";
          }
        }

        const supabase = createSupabaseBrowserClient();

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          window.history.replaceState(null, "", window.location.pathname);
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) {
            setMessage("Session manquante. Redirection…");
            router.replace("/auth/login?from=member");
          }
          return;
        }

        const websiteReady = await isWebsiteCheckoutTunnelComplete(supabase, user.id);
        if (!websiteReady) {
          if (!cancelled) {
            setMessage("Finalise ton inscription…");
            const { data } = await supabase.auth.getSession();
            const at = data.session?.access_token;
            const rt = data.session?.refresh_token;
            const target = new URL(websiteOnboardingResumeUrl());
            if (at && rt) {
              target.hash = new URLSearchParams({
                access_token: at,
                refresh_token: rt,
                token_type: "bearer",
                type: "website_signin",
              }).toString();
            }
            window.location.assign(target.toString());
          }
          return;
        }

        if (handoffType === "website_activate_segnax") {
          try {
            sessionStorage.removeItem(HANDOFF_TYPE_KEY);
          } catch {
            // ignore
          }
          if (!cancelled) {
            setMessage("Activation SegnaX…");
            router.replace("/package/activate-segnax");
          }
          return;
        }

        if (handoffType === "website_skip_subscription") {
          try {
            sessionStorage.removeItem(HANDOFF_TYPE_KEY);
          } catch {
            // ignore
          }
        }

        const { data: onboardingData } = await supabase
          .from("onboarding_sessions")
          .select("current_step, status")
          .eq("user_id", user.id)
          .maybeSingle();

        let nextPath: string = MEMBER_HOME_HREF;
        if (onboardingData?.status !== "completed") {
          const step = onboardingData?.current_step;
          if (typeof step === "string" && step.startsWith("/onboarding/")) {
            nextPath = step;
          } else {
            nextPath = "/onboarding/3";
          }
        }

        if (!cancelled) router.replace(nextPath);
      } catch {
        if (!cancelled) {
          setMessage("Connexion impossible. Redirection…");
          router.replace("/auth/login?from=member");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-white px-6">
      <p className="text-sm font-medium text-zinc-700">{message}</p>
    </main>
  );
}
