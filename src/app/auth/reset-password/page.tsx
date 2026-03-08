"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { passwordSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PasswordFormValues = {
  password: string;
  confirmPassword: string;
};

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setErrorMessage(null);

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/auth/sign-in");
  });

  return (
    <AuthScreen
      title="Nouveau mot de passe"
      description="Definis un nouveau mot de passe pour ton compte."
      footer={
        <Link href="/auth/sign-in" className="font-semibold text-zinc-700">
          Retour a la connexion
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium text-zinc-600">
            Mot de passe
          </label>
          <Input id="password" type="password" {...register("password")} />
          {errors.password ? <p className="text-xs text-[#E44D3E]">{errors.password.message}</p> : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="text-xs font-medium text-zinc-600">
            Confirmation
          </label>
          <Input id="confirmPassword" type="password" {...register("confirmPassword")} />
          {errors.confirmPassword ? (
            <p className="text-xs text-[#E44D3E]">{errors.confirmPassword.message}</p>
          ) : null}
        </div>

        {errorMessage ? <p className="text-xs text-[#E44D3E]">{errorMessage}</p> : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Mise a jour..." : "Mettre a jour"}
        </Button>
      </form>
    </AuthScreen>
  );
}
