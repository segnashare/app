"use client";

import type { Provider } from "@supabase/supabase-js";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type AuthOAuthIntent = "signup" | "member";

type AuthOAuthButtonsProps = {
  intent: AuthOAuthIntent;
  errorCode?: string | null;
  className?: string;
};

type OAuthProviderOption = {
  provider: Provider;
  label: string;
  Icon: () => React.ReactNode;
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

const OAUTH_PROVIDER_OPTIONS: OAuthProviderOption[] = [
  { provider: "google", label: "Continuer avec Google", Icon: GoogleIcon },
];

function getOAuthErrorMessage(code: string | null | undefined) {
  switch (code) {
    case "provider_error":
      return "Connexion annulée ou refusée par le fournisseur.";
    case "missing_code":
      return "Connexion incomplète. Réessaie.";
    case "exchange_failed":
      return "Impossible de finaliser la connexion. Réessaie.";
    case "missing_user":
      return "Session introuvable après connexion. Réessaie.";
    case "bootstrap_failed":
      return "Connexion réussie, mais l'initialisation du compte a échoué.";
    default:
      return null;
  }
}

export function AuthOAuthButtons({ intent, errorCode, className }: AuthOAuthButtonsProps) {
  const supabase = createSupabaseBrowserClient();
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);
  const callbackErrorMessage = getOAuthErrorMessage(errorCode);
  const displayedErrorMessage = localErrorMessage ?? callbackErrorMessage;

  const handleOAuthSignIn = async (provider: Provider) => {
    if (pendingProvider) return;

    setLocalErrorMessage(null);
    setPendingProvider(provider);

    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("intent", intent);

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectTo.toString(),
        queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
      },
    });

    if (error) {
      setLocalErrorMessage(error.message || "Impossible de lancer la connexion.");
      setPendingProvider(null);
    }
  };

  return (
    <div className={cn(montserrat.className, "flex w-full flex-col items-center gap-3", className)}>
      <div className="flex w-full max-w-[320px] items-center gap-3 text-[12px] font-bold uppercase tracking-[0.12em] text-[#B7B7B7]">
        <span className="h-px flex-1 bg-[#E5E5E5]" aria-hidden />
        <span>ou</span>
        <span className="h-px flex-1 bg-[#E5E5E5]" aria-hidden />
      </div>

      <div className="flex w-full max-w-[320px] flex-col gap-2">
        {OAUTH_PROVIDER_OPTIONS.map(({ provider, label, Icon }) => {
          const isPending = pendingProvider === provider;
          return (
            <button
              key={provider}
              type="button"
              onClick={() => void handleOAuthSignIn(provider)}
              disabled={Boolean(pendingProvider)}
              className="flex h-[48px] w-full items-center justify-center gap-3 rounded-full border border-[#D9D9D9] bg-white px-5 text-[15px] font-bold text-zinc-950 transition hover:border-zinc-950 disabled:cursor-wait disabled:opacity-60"
            >
              <Icon />
              <span>{isPending ? "Redirection..." : label}</span>
            </button>
          );
        })}
      </div>

      {displayedErrorMessage ? (
        <p role="alert" className="w-full max-w-[320px] text-center text-[14px] font-semibold leading-snug text-[#E44D3E]">
          {displayedErrorMessage}
        </p>
      ) : null}
    </div>
  );
}
