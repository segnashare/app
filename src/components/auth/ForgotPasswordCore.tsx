"use client";

import { Playfair_Display } from "next/font/google";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/Input";
import { emailSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type EmailFormValues = {
  email: string;
};

type ForgotPasswordCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export function ForgotPasswordCore({ formId, onCanContinueChange }: ForgotPasswordCoreProps) {
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

  return (
    <div className="mt-8 w-full">
      <p className="max-w-[380px] text-[20px] leading-[1.3] text-zinc-800">
        On t&apos;envoie un lien de réinitialisation par e-mail.
      </p>

      <form id={formId} onSubmit={onSubmit} noValidate className="mt-10">
        <div>
          <Input
            id="email"
            type="email"
            placeholder="email@example.com"
            autoComplete="email"
            className={cn(
              playfairDisplay.className,
              "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-4 pt-0 text-[clamp(1rem,7vw,2.75rem)] font-extrabold italic leading-none outline-none placeholder:italic focus:border-b-2",
              hasEmailError
                ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43] focus:border-[#d56a61]"
                : "border-zinc-900 text-zinc-900 placeholder:text-zinc-900 focus:border-zinc-900",
            )}
            {...register("email")}
          />
        </div>

        {hasEmailError ? <p className="mt-3 text-[20px] font-medium text-[#E44D3E]">Merci d&apos;indiquer une adresse e-mail valide.</p> : null}
        {submitError ? <p className="mt-3 text-[16px] font-medium text-[#E44D3E]">{submitError}</p> : null}
        {status ? <p className="mt-3 text-[16px] font-medium text-emerald-700">{status}</p> : null}
      </form>
    </div>
  );
}
