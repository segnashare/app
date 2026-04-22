"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";

const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

import { Input } from "@/components/ui/Input";
import { signInSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type SignInFormValues = {
  email: string;
  password: string;
};

export type SignInFooterState = {
  email: string | null;
  password: string | null;
  general: string | null;
};

type SignInCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  /** Quand défini, les messages d’erreur sont laissés au parent (ex. sous le bouton Continuer). */
  onFooterStateChange?: (state: SignInFooterState) => void;
  /** From "Je suis membre": show sign-in even if a session exists; offer continue or sign out. */
  memberEntry?: boolean;
};

export function SignInCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  onFooterStateChange,
  memberEntry = false,
}: SignInCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authErrorType, setAuthErrorType] = useState<"account_not_found" | "wrong_password" | null>(null);
  const [activeSessionEmail, setActiveSessionEmail] = useState<string | null>(null);
  const [passwordPlainVisible, setPasswordPlainVisible] = useState(false);

  const resolvePostSignInPath = useCallback(
    async (userId: string) => {
      const { data: onboardingData } = await supabase
        .from("onboarding_sessions")
        .select("current_step, status")
        .eq("user_id", userId)
        .maybeSingle();

      if (onboardingData?.status === "completed") return "/home";
      if (onboardingData?.current_step?.startsWith("/onboarding/")) return onboardingData.current_step;

      const { data: profileRow } = await supabase
        .from("user_profiles")
        .select("score, profile_data")
        .eq("user_id", userId)
        .maybeSingle();
      const profileData = (profileRow?.profile_data ?? {}) as Record<string, unknown>;
      const rawScore = profileRow?.score ?? profileData.completion_score ?? profileData.profile_completion ?? profileData.score ?? profileData.progress_score;
      const numericScore = typeof rawScore === "number" ? rawScore : Number(rawScore);
      if (Number.isFinite(numericScore) && numericScore >= 100) return "/home";

      return "/onboarding/1";
    },
    [supabase],
  );

  useEffect(() => {
    if (memberEntry) return;

    const redirectIfAlreadySignedIn = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) return;
      const targetPath = await resolvePostSignInPath(user.id);
      router.replace(targetPath);
    };

    void redirectIfAlreadySignedIn();
  }, [memberEntry, resolvePostSignInPath, router, supabase]);

  useEffect(() => {
    if (!memberEntry) return;

    void (async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        setActiveSessionEmail(null);
        return;
      }
      setActiveSessionEmail(user.email ?? null);
    })();
  }, [memberEntry, supabase]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    mode: "onChange",
  });

  useEffect(() => {
    onCanContinueChange?.(isValid && !isSubmitting);
  }, [isSubmitting, isValid, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  const hasEmailError = Boolean(errors.email) || authErrorType === "account_not_found";
  const hasPasswordError = Boolean(errors.password) || authErrorType === "wrong_password";

  useEffect(() => {
    if (!onFooterStateChange) return;
    onFooterStateChange({
      email: errors.email?.message ?? (authErrorType === "account_not_found" ? "Ce compte n'existe pas." : null),
      password: errors.password?.message ?? (authErrorType === "wrong_password" ? "Mot de passe incorrect." : null),
      general: errorMessage && !authErrorType ? errorMessage : null,
    });
  }, [errors.email?.message, errors.password?.message, authErrorType, errorMessage, onFooterStateChange]);

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setErrorMessage(null);
    setAuthErrorType(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      const normalizedMessage = (error.message ?? "").toLowerCase();
      if (normalizedMessage.includes("invalid login credentials")) {
        try {
          const response = await fetch("/api/auth/user-exists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const payload = (await response.json()) as { exists?: boolean };
          if (payload.exists) {
            setAuthErrorType("wrong_password");
            setErrorMessage("Mot de passe incorrect.");
          } else {
            setAuthErrorType("account_not_found");
            setErrorMessage("Ce compte n'existe pas.");
          }
        } catch {
          setErrorMessage("Identifiants invalides.");
        }
        return;
      }

      setErrorMessage(error.message || "Erreur de connexion.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/onboarding");
      return;
    }
    const targetPath = await resolvePostSignInPath(user.id);
    router.replace(targetPath);
  });

  const handleContinueExistingSession = async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return;
    const targetPath = await resolvePostSignInPath(user.id);
    router.replace(targetPath);
  };

  const handleSignOutMemberEntry = async () => {
    await supabase.auth.signOut();
    setActiveSessionEmail(null);
    router.refresh();
  };

  const showInlineErrors = !onFooterStateChange;

  return (
    <div className={cn(montserrat.className, "flex w-full flex-col items-center")}>
      {memberEntry && activeSessionEmail ? (
        <div className="mb-6 w-full max-w-[min(100%,380px)] rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-zinc-800">
          <p className="text-[15px] font-medium leading-snug">
            Tu es déjà connecté avec <span className="text-zinc-950">{activeSessionEmail}</span>.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <button
              type="button"
              className={cn(
                themeClassNames.auth.pillCtaTextSize,
                "rounded-full bg-zinc-900 py-3 font-semibold text-white",
              )}
              onClick={() => void handleContinueExistingSession()}
            >
              Continuer où j&apos;en étais
            </button>
            <button
              type="button"
              className="text-[15px] font-semibold text-[#8B6A54] underline underline-offset-2"
              onClick={() => void handleSignOutMemberEntry()}
            >
              Me déconnecter et me connecter avec un autre compte
            </button>
          </div>
        </div>
      ) : null}

      <form id={formId} className="flex w-full flex-col items-center gap-2" onSubmit={onSubmit} noValidate>
        <div className="w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="E-mail"
            className={cn(
              playfairDisplay.className,
              "h-auto w-full rounded-none border-0 bg-transparent py-1 pr-0 text-left text-[clamp(1.125rem,5vw,1.5rem)] font-extrabold not-italic leading-tight tracking-tight text-black outline-none ring-0 focus:ring-0",
              "caret-zinc-900 [caret-width:2px]",
              "placeholder:font-segna-montserrat placeholder:font-semibold placeholder:not-italic placeholder:text-[#999999]",
              hasEmailError ? "placeholder:text-[#df4e43]" : null,
            )}
            style={hasEmailError ? ({ color: "#df4e43", WebkitTextFillColor: "#df4e43" } as CSSProperties) : undefined}
            {...register("email")}
          />
          {showInlineErrors && errors.email ? <p className="mt-2 text-[14px] font-semibold text-[#E44D3E]">{errors.email.message}</p> : null}
          {showInlineErrors && !errors.email && authErrorType === "account_not_found" ? (
            <p className="mt-2 text-[14px] font-semibold text-[#E44D3E]">Ce compte n&apos;existe pas.</p>
          ) : null}
        </div>

        <div className="relative w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
          <Input
            id="password"
            type={passwordPlainVisible ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Mot de passe"
            className={cn(
              playfairDisplay.className,
              "h-auto w-full rounded-none border-0 bg-transparent py-1 pr-11 text-left text-[clamp(1.125rem,5vw,1.5rem)] font-extrabold not-italic leading-tight tracking-tight text-black outline-none ring-0 focus:ring-0 sm:pr-12",
              "caret-zinc-900 [caret-width:2px]",
              "placeholder:font-segna-montserrat placeholder:font-semibold placeholder:not-italic placeholder:text-[#999999]",
              hasPasswordError ? "placeholder:text-[#df4e43]" : null,
            )}
            style={hasPasswordError ? ({ color: "#df4e43", WebkitTextFillColor: "#df4e43" } as CSSProperties) : undefined}
            {...register("password")}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-zinc-900 transition-opacity hover:opacity-80"
            onClick={() => setPasswordPlainVisible((v) => !v)}
            aria-label={passwordPlainVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            aria-pressed={passwordPlainVisible}
          >
            <img
              src={passwordPlainVisible ? "/ressources/icons/mask.svg" : "/ressources/icons/visible.svg"}
              alt=""
              width={30}
              height={24}
              className="pointer-events-none max-h-[22px] w-auto object-contain opacity-70"
            />
          </button>
          {showInlineErrors && errors.password ? <p className="mt-2 pr-10 text-[14px] font-semibold text-[#E44D3E]">{errors.password.message}</p> : null}
          {showInlineErrors && !errors.password && authErrorType === "wrong_password" ? (
            <p className="mt-2 pr-10 text-[14px] font-semibold text-[#E44D3E]">Mot de passe incorrect.</p>
          ) : null}
        </div>

        <div className="w-full max-w-[min(100%,380px)] pt-1 text-right">
          <Link href="/auth/forgot-password" className="text-[14px] font-semibold text-[#999999] underline underline-offset-2 hover:text-zinc-600">
            Mot de passe oublié ?
          </Link>
        </div>

        {showInlineErrors && errorMessage && !authErrorType ? (
          <p className="w-full max-w-[min(100%,380px)] text-[14px] font-semibold text-[#E44D3E]">{errorMessage}</p>
        ) : null}
      </form>
    </div>
  );
}
