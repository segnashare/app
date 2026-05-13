"use client";

import Link from "next/link";
import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AuthOAuthButtons } from "@/components/auth/AuthOAuthButtons";
import { SignUpEmailCore, type SignUpEmailAuthErrorState } from "@/components/auth/SignUpEmailCore";
import { OnboardingScreenShell } from "@/components/onboarding/OnboardingScreenShell";
import { AuthRingDotSpinner } from "@/components/ui/AuthRingDotSpinner";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

const montserrat = segnaMontserrat;

const AUTH_BG = "bg-white";

function SignUpEmailPageContent() {
  const [canContinue, setCanContinue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authErrors, setAuthErrors] = useState<SignUpEmailAuthErrorState>({
    field: null,
    submit: null,
    showLoginLink: false,
  });
  const searchParams = useSearchParams();
  const oauthErrorCode = searchParams.get("oauth_error");

  const handleAuthErrorStateChange = useCallback((state: SignUpEmailAuthErrorState) => {
    setAuthErrors(state);
  }, []);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    setIsSubmitting(submitting);
  }, []);

  const footerErrorVisible = Boolean(authErrors.field || authErrors.submit);

  return (
    <OnboardingScreenShell
      currentStep="/auth/sign-up/email"
      nextStep="/auth/sign-up/verify"
      showStepTracker={false}
      persistProgressOnNext={false}
      centeredAuthLayout
      appViewportOuterClassName={AUTH_BG}
      appViewportClassName={AUTH_BG}
      headerAccessoryTopRight={
        <Link
          href="/auth/login"
          className={cn(
            montserrat.className,
            "text-[15px] font-semibold text-[#999999] transition-colors hover:text-zinc-600",
          )}
        >
          Se connecter
        </Link>
      }
      centeredAuthBelowHeader={
        <AuthRingDotSpinner
          variant="onLight"
          dotCount={6}
          filledDots={6}
          spinning={isSubmitting}
          aria-label={isSubmitting ? "Envoi en cours" : undefined}
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
            Entrez votre adresse e-mail
          </h1>
          <p className={cn(montserrat.className, "text-[15px] font-bold leading-snug text-[#999999]")}>
            Inscrivez-vous ou commencez
          </p>
        </div>
      }
      mainLayout={
        <div className="flex w-full flex-col items-center gap-5">
          <SignUpEmailCore
            formId="signup-email-form"
            onCanContinueChange={setCanContinue}
            onAuthErrorStateChange={handleAuthErrorStateChange}
            onSubmittingChange={handleSubmittingChange}
          />
          <AuthOAuthButtons intent="signup" errorCode={oauthErrorCode} />
        </div>
      }
      footerRightSlot={
        <div className="flex w-full max-w-[320px] flex-col items-center gap-2">
          <button
            type="submit"
            form="signup-email-form"
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
              {authErrors.field ? <span>{authErrors.field}</span> : null}
              {authErrors.field && authErrors.submit ? <br /> : null}
              {authErrors.submit ? <span>{authErrors.submit}</span> : null}
              {authErrors.showLoginLink ? (
                <>
                  {" "}
                  <Link href="/auth/login" className={cn(montserrat.className, "font-semibold underline")}>
                    Se connecter
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      }
    />
  );
}

export default function SignUpEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-white text-zinc-600">Chargement…</div>
      }
    >
      <SignUpEmailPageContent />
    </Suspense>
  );
}
