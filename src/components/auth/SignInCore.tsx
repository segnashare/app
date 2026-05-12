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
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [passwordPlainVisible, setPasswordPlainVisible] = useState(false);

  const resolvePostSignInPath = useCallback(
    async (userId: string) => {
      const { data: onboardingData } = await supabase
        .from("onboarding_sessions")
        .select("current_step, status")
        .eq("user_id", userId)
        .maybeSingle();

      if (onboardingData?.status === "completed") return "/shop";
      if (onboardingData?.current_step?.startsWith("/onboarding/")) return onboardingData.current_step;

      const { data: profileRow } = await supabase
        .from("user_profiles")
        .select("score, profile_data")
        .eq("user_id", userId)
        .maybeSingle();
      const profileData = (profileRow?.profile_data ?? {}) as Record<string, unknown>;
      const rawScore = profileRow?.score ?? profileData.completion_score ?? profileData.profile_completion ?? profileData.score ?? profileData.progress_score;
      const numericScore = typeof rawScore === "number" ? rawScore : Number(rawScore);
      if (Number.isFinite(numericScore) && numericScore >= 100) return "/shop";

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
    formState: { errors, isSubmitting, isValid, touchedFields, isSubmitted },
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

  // N'affiche les erreurs qu'après une action utilisateur :
  // - blur du champ (ex. clic sur le champ mot de passe quitte le champ e-mail)
  // - tentative de soumission (clic sur Continuer)
  const showEmailError = Boolean(touchedFields.email) || isSubmitted;
  const showPasswordError = Boolean(touchedFields.password) || isSubmitted;

  const hasEmailError =
    (showEmailError && Boolean(errors.email)) || authErrorType === "account_not_found";
  const hasPasswordError =
    (showPasswordError && Boolean(errors.password)) || authErrorType === "wrong_password";

  useEffect(() => {
    if (!onFooterStateChange) return;
    const emailMessage = showEmailError ? errors.email?.message ?? null : null;
    const passwordMessage = showPasswordError ? errors.password?.message ?? null : null;
    onFooterStateChange({
      email: emailMessage ?? (authErrorType === "account_not_found" ? "Ce compte n'existe pas." : null),
      password: passwordMessage ?? (authErrorType === "wrong_password" ? "Mot de passe incorrect." : null),
      general: errorMessage && !authErrorType ? errorMessage : null,
    });
  }, [
    errors.email?.message,
    errors.password?.message,
    showEmailError,
    showPasswordError,
    authErrorType,
    errorMessage,
    onFooterStateChange,
  ]);

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
    if (isSigningOut) return;
    setErrorMessage(null);
    setIsSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message || "Impossible de te déconnecter.");
      setIsSigningOut(false);
      return;
    }
    setActiveSessionEmail(null);
    router.replace("/auth/login");
    router.refresh();
  };

  const showInlineErrors = !onFooterStateChange;

  return (
    <div className={cn(montserrat.className, "flex w-full flex-col items-center")}>
      {memberEntry && activeSessionEmail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-5 py-8 backdrop-blur-[3px]">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-existing-session-title"
            className="w-full max-w-[360px] rounded-[30px] border border-white/70 bg-white px-6 py-7 text-center text-zinc-900 shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
          >
            <p id="signin-existing-session-title" className="text-[20px] font-semibold leading-snug tracking-[-0.02em]">
              Tu es déjà connecté
            </p>
            <p className="mt-3 break-words text-[15px] font-medium leading-snug text-zinc-500">
              avec <span className="font-semibold text-zinc-950">{activeSessionEmail}</span>.
            </p>
            <div className="mt-6 flex flex-col gap-4">
              <button
                type="button"
                className={cn(
                  "mx-auto h-[48px] w-full max-w-[280px] rounded-full bg-zinc-950 px-5 text-[16px] font-bold text-white transition hover:bg-zinc-900",
                )}
                onClick={() => void handleContinueExistingSession()}
              >
                Continuer
              </button>
              <button
                type="button"
                className="px-4 text-[14px] font-bold leading-snug text-zinc-950 underline underline-offset-4 transition hover:text-zinc-700 disabled:cursor-wait disabled:opacity-60"
                onClick={() => void handleSignOutMemberEntry()}
                disabled={isSigningOut}
              >
                {isSigningOut ? "Déconnexion..." : "Changer de compte"}
              </button>
            </div>
            {errorMessage && !authErrorType ? (
              <p className="mt-4 text-[14px] font-semibold leading-snug text-[#E44D3E]">{errorMessage}</p>
            ) : null}
          </section>
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
          {showInlineErrors && showEmailError && errors.email ? <p className="mt-2 text-[14px] font-semibold text-[#E44D3E]">{errors.email.message}</p> : null}
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
          {showInlineErrors && showPasswordError && errors.password ? <p className="mt-2 pr-10 text-[14px] font-semibold text-[#E44D3E]">{errors.password.message}</p> : null}
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
