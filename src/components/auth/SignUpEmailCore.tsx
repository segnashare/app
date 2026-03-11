"use client";

import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/Input";
import { emailSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type EmailFormValues = {
  email: string;
};

type SignUpEmailCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export function SignUpEmailCore({ formId, onCanContinueChange }: SignUpEmailCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
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
    setSubmitError(null);

    try {
      const response = await fetch("/api/auth/user-exists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { exists?: boolean };
      if (payload.exists) {
        setSubmitError("Un compte existe deja avec cet e-mail. Connecte-toi.");
        return;
      }
    } catch {
      // If the check endpoint is temporarily unavailable, keep sign-up flow available.
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });

    if (error) {
      const rawMessage = typeof error.message === "string" ? error.message : "";
      const normalizedMessage = rawMessage.toLowerCase();
      if (normalizedMessage.includes("email rate limit exceeded") || normalizedMessage.includes("login.new_email")) {
        setSubmitError("Trop de tentatives. Attends un peu avant de demander un nouvel e-mail.");
        console.error("[sign-up/email] Email rate limit exceeded", { email, error });
        return;
      }
      if (normalizedMessage.includes("error sending confirmation email")) {
        setSubmitError("Impossible d'envoyer l'e-mail pour le moment. Réessaie dans quelques instants.");
        console.error("[sign-up/email] Error sending confirmation email", { email, error });
        return;
      }
      setSubmitError("Une erreur est survenue. Réessaie.");
      console.error("[sign-up/email] OTP request failed", { email, error });
      return;
    }

    router.replace(`/auth/sign-up/verify?email=${encodeURIComponent(email)}&sentAt=${Date.now()}`);
  });

  const hasEmailError = Boolean(errors.email);

  return (
    <div className="mt-8 w-full">
      <p className="max-w-[340px] text-[20px] leading-[1.3] text-zinc-800">
        La vérification de ton adresse e-mail nous aide à sécuriser ton compte. <span className="font-bold">En savoir plus</span>
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
        {submitError ? (
          <p className="mt-3 text-[16px] font-medium text-[#E44D3E]">
            {submitError}{" "}
            <Link href="/auth/sign-in" className="underline">
              Se connecter
            </Link>
          </p>
        ) : null}
      </form>
    </div>
  );
}
