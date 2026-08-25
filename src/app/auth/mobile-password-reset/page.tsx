"use client";

import { useEffect, useMemo, useState } from "react";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

/**
 * Bridge e-mail reset → app native.
 * Supabase redirige ici (HTTPS allowlisté), puis on ouvre
 * `segna://profile/password` avec les mêmes tokens / code.
 */
function buildNativeDeepLink(): string {
  if (typeof window === "undefined") return "segna://profile/password?recovery=1";

  const url = new URL(window.location.href);
  const query = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

  if (!query.get("type") && !hash.get("type")) {
    query.set("type", "recovery");
  }
  if (!query.get("recovery") && !hash.get("recovery")) {
    query.set("recovery", "1");
  }

  const q = query.toString();
  const h = hash.toString();
  return `segna://profile/password${q ? `?${q}` : ""}${h ? `#${h}` : ""}`;
}

export default function AuthMobilePasswordResetPage() {
  const [deepLink, setDeepLink] = useState("segna://profile/password?recovery=1");
  const [autoTried, setAutoTried] = useState(false);

  useEffect(() => {
    const link = buildNativeDeepLink();
    setDeepLink(link);
    // Laisse le navigateur peindre, puis ouvre l’app.
    const t = window.setTimeout(() => {
      setAutoTried(true);
      window.location.replace(link);
    }, 120);
    return () => window.clearTimeout(t);
  }, []);

  const hint = useMemo(
    () =>
      autoTried
        ? "Si l’app ne s’ouvre pas, appuie sur le bouton ci-dessous."
        : "Ouverture de Segna…",
    [autoTried],
  );

  return (
    <main
      className={cn(
        segnaMontserrat.className,
        "flex min-h-[100dvh] flex-col items-center justify-center bg-white px-6 text-center",
      )}
    >
      <h1 className="text-[22px] font-bold text-zinc-900">Réinitialiser ton mot de passe</h1>
      <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-zinc-600">{hint}</p>
      <a
        href={deepLink}
        className="mt-8 inline-flex min-h-[48px] items-center justify-center rounded-full bg-zinc-950 px-6 text-[15px] font-semibold text-white"
      >
        Ouvrir Segna
      </a>
      <p className="mt-4 max-w-sm text-[12px] leading-relaxed text-zinc-400">
        Tu pourras choisir un nouveau mot de passe directement dans l’app, sans saisir l’ancien.
      </p>
    </main>
  );
}
