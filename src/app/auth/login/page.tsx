"use client";

import Link from "next/link";
import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthOAuthButtons } from "@/components/auth/AuthOAuthButtons";
import { SignInCore, type SignInFooterState } from "@/components/auth/SignInCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

const AUTH_BG = "bg-white";

function LoginPageContent() {
  const [canContinue, setCanContinue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [footerState, setFooterState] = useState<SignInFooterState>({
    email: null,
    password: null,
    general: null,
  });
  const searchParams = useSearchParams();
  const memberEntry = searchParams.get("from") === "member";
  const oauthErrorCode = searchParams.get("oauth_error");

  const handleFooterStateChange = useCallback((state: SignInFooterState) => {
    setFooterState(state);
  }, []);

  const footerErrorVisible = Boolean(footerState.email || footerState.password || footerState.general);

  return (
    <OnboardingScreenShell
      currentStep="/auth/login"
      nextStep="/onboarding/1"
      showStepTracker={false}
      persistProgressOnNext={false}
      centeredAuthLayout
      centeredAuthSectionGapClassName="gap-y-[clamp(1.5rem,4.5dvh,4rem)] md:gap-y-10"
      appViewportOuterClassName={AUTH_BG}
      appViewportClassName={AUTH_BG}
      headerAccessoryTopRight={
        <Link
          href="/auth/sign-up/email"
          className={cn(
            montserrat.className,
            "text-[15px] font-semibold text-[#999999] transition-colors hover:text-zinc-600",
          )}
        >
          S&apos;inscrire
        </Link>
      }
      centeredAuthBelowHeader={
        <AuthRingDotSpinner
          variant="onLight"
          dotCount={6}
          filledDots={6}
          spinning={isSubmitting}
          aria-label={isSubmitting ? "Connexion en cours" : undefined}
        />
      }
      h1Principal={
        <div className="mx-auto flex w-full flex-col items-center gap-2 text-center">
          <h1
            className={cn(
              montserrat.className,
              "text-[clamp(1.35rem,5.5vw,1.875rem)] font-bold leading-tight tracking-tight text-black",
            )}
          >
            Se connecter
          </h1>
          <p className={cn(montserrat.className, "text-[15px] font-bold leading-snug text-[#999999]")}>
            E-mail et mot de passe, ou Google ci-dessous.
          </p>
        </div>
      }
      mainLayout={
        <div className="flex w-full flex-col items-center gap-5">
          <SignInCore
            formId="signin-form"
            onCanContinueChange={setCanContinue}
            onSubmittingChange={setIsSubmitting}
            onFooterStateChange={handleFooterStateChange}
            memberEntry={memberEntry}
          />
          <AuthOAuthButtons intent="member" errorCode={oauthErrorCode} />
        </div>
      }
      footerRightSlot={
        <div className="flex w-full max-w-[320px] flex-col items-center gap-2">
          <button
            type="submit"
            form="signin-form"
            disabled={isSubmitting}
            className={cn(
              montserrat.className,
              themeClassNames.auth.pillCtaTextSize,
              "h-[52px] w-full max-w-[320px] rounded-full font-bold transition-colors",
              canContinue
                ? cn(
                    "bg-black text-white hover:bg-zinc-900",
                    isSubmitting && "cursor-wait opacity-80 hover:bg-black",
                  )
                : "cursor-pointer bg-[#D3D3D3] text-white hover:bg-[#c4c4c4]",
            )}
          >
            Continuer
          </button>
          {footerErrorVisible ? (
            <p
              role="alert"
              className={cn(
                montserrat.className,
                themeClassNames.onboarding.textes.erreurFormulaire,
                "w-full max-w-[320px] text-center text-[14px] font-semibold leading-snug",
              )}
            >
              {footerState.email ? <span>{footerState.email}</span> : null}
              {footerState.email && (footerState.password || footerState.general) ? <br /> : null}
              {footerState.password ? <span>{footerState.password}</span> : null}
              {footerState.password && footerState.general ? <br /> : null}
              {footerState.general ? <span>{footerState.general}</span> : null}
            </p>
          ) : null}
        </div>
      }
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-white text-zinc-600">Chargement…</div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
