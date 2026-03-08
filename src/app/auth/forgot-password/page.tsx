"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { emailSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type EmailFormValues = {
  email: string;
};

export default function ForgotPasswordPage() {
  const supabase = createSupabaseBrowserClient();
  const [status, setStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setStatus(null);
    setErrorMessage(null);

    const redirectTo = `${window.location.origin}/auth/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setStatus("Email envoye. Verifie ta boite mail.");
  });

  return (
    <AuthScreen
      title="Mot de passe oublie"
      description="On t'envoie un lien de reinitialisation par email."
      footer={
        <Link href="/auth/sign-in" className="font-semibold text-zinc-700">
          Retour a la connexion
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-xs font-medium text-zinc-600">
            Email
          </label>
          <Input id="email" type="email" placeholder="toi@email.com" {...register("email")} />
          {errors.email ? <p className="text-xs text-[#E44D3E]">{errors.email.message}</p> : null}
        </div>

        {errorMessage ? <p className="text-xs text-[#E44D3E]">{errorMessage}</p> : null}
        {status ? <p className="text-xs text-emerald-700">{status}</p> : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Envoi..." : "Envoyer le lien"}
        </Button>
      </form>
    </AuthScreen>
  );
}
