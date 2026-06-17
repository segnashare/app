"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";

const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

import { Input } from "@/components/ui/Input";
import { signUpPasswordSchema } from "@/features/auth/lib/schemas";
import { trackClientSignupOnce } from "@/lib/analytics/track-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearReferralInviteClient, readReferralCodeForBootstrap } from "@/lib/referral/referralInviteStorage";
import { cn } from "@/lib/utils/cn";

export type SignUpPasswordFooterState = {
  field: string | null;
  submit: string | null;
};

type PasswordFormValues = {
  password: string;
};

type SignUpPasswordCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  onFooterStateChange?: (state: SignUpPasswordFooterState) => void;
};

export function SignUpPasswordCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  onFooterStateChange,
}: SignUpPasswordCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const rpcUntyped = async (fn: string, args?: Record<string, unknown>) =>
    (supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data?: unknown; error?: { message?: string } | null } | undefined>)(fn, args);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passwordPlainVisible, setPasswordPlainVisible] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(signUpPasswordSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: { password: "" },
  });

  const passwordValue = watch("password");
  const passwordOk = signUpPasswordSchema.safeParse({ password: passwordValue ?? "" }).success;

  useEffect(() => {
    onCanContinueChange?.(passwordOk && !isSubmitting);
  }, [passwordOk, isSubmitting, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    onFooterStateChange?.({
      field: isSubmitted ? (errors.password?.message ?? null) : null,
      submit: errorMessage,
    });
  }, [errors.password?.message, isSubmitted, errorMessage, onFooterStateChange]);

  const onSubmit = handleSubmit(
    async ({ password }) => {
      setErrorMessage(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setErrorMessage("Session invalide. Recommence l'inscription.");
        return;
      }

      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) {
        const normalized = (passwordError.message ?? "").toLowerCase();
        if (normalized.includes("new password should be different from the old password")) {
          setErrorMessage("Le nouveau mot de passe doit être différent de l'ancien.");
        } else {
          setErrorMessage(passwordError.message);
        }
        return;
      }

      const requestId = crypto.randomUUID();
      const referralCode = readReferralCodeForBootstrap();

      const bootstrapResult = await rpcUntyped("bootstrap_user_after_signup", {
        p_first_name: null,
        p_last_name: null,
        p_locale: null,
        p_timezone: null,
        p_request_id: requestId,
        p_referral_code: referralCode,
      });
      if (bootstrapResult?.error) {
        setErrorMessage(bootstrapResult.error.message ?? "Impossible d'initialiser ton compte.");
        return;
      }

      trackClientSignupOnce({
        method: "email",
        referral_code_present: Boolean(referralCode),
      });

      clearReferralInviteClient();

      const progressResult = await rpcUntyped("upsert_onboarding_progress", {
        p_current_step: "/onboarding/1",
        p_progress_json: { checkpoint: "/onboarding/1" },
        p_request_id: requestId,
      });
      if (progressResult?.error) {
        setErrorMessage(progressResult.error.message ?? "Impossible d'enregistrer ta progression.");
        return;
      }

      router.prefetch("/onboarding/1");
      router.replace("/onboarding/1");
    },
    () => {
      setErrorMessage(null);
    },
  );

  const hasPasswordError = Boolean(isSubmitted && errors.password);

  return (
    <div className={cn(montserrat.className, "flex w-full flex-col items-center")}>
      <form id={formId} onSubmit={onSubmit} noValidate className="mt-1.5 flex w-full flex-col items-center gap-2 md:mt-2 md:gap-2.5">
        <div className="relative w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
          <Input
            id="password"
            type={passwordPlainVisible ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Mot de passe"
            className={cn(
              playfairDisplay.className,
              "h-auto w-full rounded-none border-0 bg-transparent py-1 pr-11 text-left text-[clamp(1.125rem,5vw,1.5rem)] font-extrabold not-italic leading-tight tracking-tight text-black outline-none ring-0 focus:ring-0 sm:pr-12",
              "caret-zinc-900 [caret-width:2px]",
              "placeholder:font-segna-montserrat placeholder:font-semibold placeholder:not-italic placeholder:text-[#999999]",
              hasPasswordError ? "placeholder:text-[#df4e43]" : null,
            )}
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
        </div>
      </form>
    </div>
  );
}
