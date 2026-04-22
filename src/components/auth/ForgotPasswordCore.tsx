"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";

const montserrat = segnaMontserrat;
const playfairDisplay = segnaPlayfairDisplay;

import { Input } from "@/components/ui/Input";
import { emailSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type EmailFormValues = {
  email: string;
};

export type ForgotPasswordFooterState = {
  field: string | null;
  submit: string | null;
  status: string | null;
};

type ForgotPasswordCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  onFooterStateChange?: (state: ForgotPasswordFooterState) => void;
};

export function ForgotPasswordCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  onFooterStateChange,
}: ForgotPasswordCoreProps) {
  const supabase = createSupabaseBrowserClient();
  const [status, setStatus] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    mode: "onChange",
  });

  useEffect(() => {
    onCanContinueChange?.(isValid && !isSubmitting);
  }, [isSubmitting, isValid, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    onFooterStateChange?.({
      field: errors.email?.message ?? null,
      submit: submitError,
      status,
    });
  }, [errors.email?.message, submitError, status, onFooterStateChange]);

  const onSubmit = handleSubmit(async ({ email }) => {
    setStatus(null);
    setSubmitError(null);

    try {
      const response = await fetch("/api/auth/user-exists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { exists?: boolean };
      if (!payload.exists) {
        setSubmitError("Ce compte n'existe pas.");
        return;
      }
    } catch {
      setSubmitError("Impossible de vérifier ce compte pour le moment.");
      return;
    }

    const redirectTo = `${window.location.origin}/auth/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      setSubmitError("Impossible d'envoyer le lien pour le moment. Réessaie dans quelques instants.");
      return;
    }

    setStatus("Lien envoyé. Vérifie ta boîte e-mail.");
  });

  const hasEmailError = Boolean(errors.email);
  const showInline = !onFooterStateChange;

  return (
    <div className={cn(montserrat.className, "flex w-full flex-col items-center")}>
      <form id={formId} onSubmit={onSubmit} noValidate className="flex w-full flex-col items-center gap-2">
        <div className="w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
          <Input
            id="email"
            type="email"
            placeholder="E-mail"
            autoComplete="email"
            className={cn(
              playfairDisplay.className,
              "h-auto w-full rounded-none border-0 bg-transparent py-1 pr-0 text-left text-[clamp(1.125rem,5vw,1.5rem)] font-extrabold not-italic leading-tight tracking-tight text-black outline-none ring-0 focus:ring-0",
              "caret-zinc-900 [caret-width:2px]",
              "placeholder:font-segna-montserrat placeholder:font-semibold placeholder:not-italic placeholder:text-[#999999]",
              hasEmailError ? "placeholder:text-[#df4e43]" : null,
            )}
            {...register("email")}
          />
          {showInline && errors.email?.message ? (
            <p className="mt-2 text-[14px] font-semibold text-[#E44D3E]">{errors.email.message}</p>
          ) : null}
        </div>

        {showInline && submitError ? <p className="w-full max-w-[min(100%,380px)] text-[14px] font-semibold text-[#E44D3E]">{submitError}</p> : null}
        {showInline && status ? <p className="w-full max-w-[min(100%,380px)] text-[14px] font-semibold text-emerald-700">{status}</p> : null}
      </form>
    </div>
  );
}
