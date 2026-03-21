"use client";

import { Playfair_Display } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/Input";
import { passwordSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type PasswordFormValues = {
  password: string;
  confirmPassword: string;
};

type ResetPasswordCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export function ResetPasswordCore({ formId, onCanContinueChange }: ResetPasswordCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isValid },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    mode: "onChange",
  });

  useEffect(() => {
    onCanContinueChange?.(isValid && !isSubmitting);
  }, [isValid, isSubmitting, onCanContinueChange]);

  const onSubmit = handleSubmit(async ({ password, confirmPassword }) => {
    setErrorMessage(null);
    if (password !== confirmPassword) {
      setError("confirmPassword", { type: "manual", message: "Les mots de passe ne correspondent pas" });
      return;
    }

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

  return (
    <div className="mt-8 w-full">
      <p className="max-w-[380px] text-[clamp(12px,5.6vw,22px)] leading-[1.3] text-zinc-800">
        Défini un nouveau mot de passe pour ton compte.
      </p>

      <form id={formId} className="mt-10 space-y-8" onSubmit={onSubmit} noValidate>
        <div>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Mot de passe"
            className={cn(
              playfairDisplay.className,
              "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-4 pt-0 text-[clamp(16px,5.6vw,30px)] font-extrabold italic leading-none outline-none placeholder:italic focus:border-b-2",
              hasPasswordError
                ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43] focus:border-[#d56a61]"
                : "border-zinc-900 text-zinc-900 placeholder:text-zinc-900 focus:border-zinc-900",
            )}
            {...register("password")}
          />
          {hasPasswordError ? <p className="mt-3 text-[20px] font-medium text-[#E44D3E]">{errors.password?.message}</p> : null}
        </div>

        <div>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Confirme le mot de passe"
            className={cn(
              playfairDisplay.className,
              "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-4 pt-0 text-[clamp(16px,5.6vw,30px)] font-extrabold italic leading-none outline-none placeholder:italic focus:border-b-2",
              hasConfirmError
                ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43] focus:border-[#d56a61]"
                : "border-zinc-900 text-zinc-900 placeholder:text-zinc-900 focus:border-zinc-900",
            )}
            {...register("confirmPassword")}
          />
          {hasConfirmError ? <p className="mt-3 text-[20px] font-medium text-[#E44D3E]">{errors.confirmPassword?.message}</p> : null}
        </div>

        {errorMessage ? <p className="text-[20px] font-medium text-[#E44D3E]">{errorMessage}</p> : null}
      </form>
    </div>
  );
}
