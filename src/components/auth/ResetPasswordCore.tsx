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
import { passwordSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type PasswordFormValues = {
  password: string;
  confirmPassword: string;
};

export type ResetPasswordFooterState = {
  password: string | null;
  confirmPassword: string | null;
  general: string | null;
};

type ResetPasswordCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  onFooterStateChange?: (state: ResetPasswordFooterState) => void;
};

export function ResetPasswordCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  onFooterStateChange,
}: ResetPasswordCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passwordPlainVisible, setPasswordPlainVisible] = useState(false);
  const [confirmPlainVisible, setConfirmPlainVisible] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    mode: "onChange",
  });

  useEffect(() => {
    onCanContinueChange?.(isValid && !isSubmitting);
  }, [isValid, isSubmitting, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    onFooterStateChange?.({
      password: errors.password?.message ?? null,
      confirmPassword: errors.confirmPassword?.message ?? null,
      general: errorMessage,
    });
  }, [errors.password?.message, errors.confirmPassword?.message, errorMessage, onFooterStateChange]);

  const onSubmit = handleSubmit(async ({ password }) => {
    setErrorMessage(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setErrorMessage("Session invalide. Redemande un lien de réinitialisation.");
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

    const { data: onboardingRow } = await supabase
      .from("onboarding_sessions")
      .select("current_step, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (onboardingRow?.status === "completed") {
      router.replace("/home");
      return;
    }

    if (onboardingRow?.current_step?.startsWith("/onboarding/")) {
      router.replace(onboardingRow.current_step);
      return;
    }

    router.replace("/onboarding");
  });

  const hasPasswordError = Boolean(errors.password);
  const hasConfirmError = Boolean(errors.confirmPassword);
  const showInline = !onFooterStateChange;

  const fieldClass = (hasErr: boolean) =>
    cn(
      playfairDisplay.className,
      "h-auto w-full rounded-none border-0 bg-transparent py-1 pr-11 text-left text-[clamp(1.125rem,5vw,1.5rem)] font-extrabold not-italic leading-tight tracking-tight text-black outline-none ring-0 focus:ring-0 sm:pr-12",
      "caret-zinc-900 [caret-width:2px]",
      "placeholder:font-segna-montserrat placeholder:font-semibold placeholder:not-italic placeholder:text-[#999999]",
      hasErr ? "placeholder:text-[#df4e43]" : null,
    );

  return (
    <div className={cn(montserrat.className, "flex w-full flex-col items-center")}>
      <form id={formId} className="flex w-full flex-col items-center gap-2" onSubmit={onSubmit} noValidate>
        <div className="relative w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
          <Input
            id="password"
            type={passwordPlainVisible ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Mot de passe"
            className={fieldClass(hasPasswordError)}
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
          {showInline && hasPasswordError ? (
            <p className="mt-2 pr-10 text-[14px] font-semibold text-[#E44D3E]">{errors.password?.message}</p>
          ) : null}
        </div>

        <div className="relative w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
          <Input
            id="confirmPassword"
            type={confirmPlainVisible ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Confirme le mot de passe"
            className={fieldClass(hasConfirmError)}
            {...register("confirmPassword")}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-zinc-900 transition-opacity hover:opacity-80"
            onClick={() => setConfirmPlainVisible((v) => !v)}
            aria-label={confirmPlainVisible ? "Masquer la confirmation" : "Afficher la confirmation"}
            aria-pressed={confirmPlainVisible}
          >
            <img
              src={confirmPlainVisible ? "/ressources/icons/mask.svg" : "/ressources/icons/visible.svg"}
              alt=""
              width={30}
              height={24}
              className="pointer-events-none max-h-[22px] w-auto object-contain opacity-70"
            />
          </button>
          {showInline && hasConfirmError ? (
            <p className="mt-2 pr-10 text-[14px] font-semibold text-[#E44D3E]">{errors.confirmPassword?.message}</p>
          ) : null}
        </div>

        {showInline && errorMessage ? (
          <p className="w-full max-w-[min(100%,380px)] text-[14px] font-semibold text-[#E44D3E]">{errorMessage}</p>
        ) : null}
      </form>
    </div>
  );
}
