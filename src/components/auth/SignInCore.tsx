"use client";

import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/Input";
import { signInSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type SignInFormValues = {
  email: string;
  password: string;
};

type SignInCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export function SignInCore({ formId, onCanContinueChange }: SignInCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authErrorType, setAuthErrorType] = useState<"account_not_found" | "wrong_password" | null>(null);

  useEffect(() => {
    const redirectIfAlreadySignedIn = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) return;

      const { data } = await supabase
        .from("onboarding_sessions")
        .select("current_step, status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data?.status === "completed") {
        router.replace("/app");
        return;
      }

      if (data?.current_step?.startsWith("/onboarding/")) {
        router.replace(data.current_step);
        return;
      }

      router.replace("/onboarding/welcome");
    };

    void redirectIfAlreadySignedIn();
  }, [router, supabase]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    mode: "onChange",
  });

  useEffect(() => {
    onCanContinueChange?.(isValid && !isSubmitting);
  }, [isSubmitting, isValid, onCanContinueChange]);

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setErrorMessage(null);
    setAuthErrorType(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      const normalizedMessage = (error.message ?? "").toLowerCase();
      if (normalizedMessage.includes("invalid login credentials")) {
        try {
          const response = await fetch("/api/auth/user-exists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const payload = (await response.json()) as { exists?: boolean };
          if (payload.exists) {
            setAuthErrorType("wrong_password");
            setErrorMessage("Mot de passe incorrect.");
          } else {
            setAuthErrorType("account_not_found");
            setErrorMessage("Ce compte n'existe pas.");
          }
        } catch {
          setErrorMessage("Identifiants invalides.");
        }
        return;
      }

      setErrorMessage(error.message || "Erreur de connexion.");
      return;
    }

    router.replace("/onboarding");
  });

  const hasEmailError = Boolean(errors.email) || authErrorType === "account_not_found";
  const hasPasswordError = Boolean(errors.password) || authErrorType === "wrong_password";

  return (
    <div className="mt-8 w-full">
      <p className="max-w-[370px] text-[clamp(12px,5.6vw,22px)] leading-[1.3] text-zinc-800">Entre ton e-mail et ton mot de passe.</p>

      <form id={formId} className="mt-10 space-y-8" onSubmit={onSubmit} noValidate>
        <div>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="E-mail"
            className={cn(
              playfairDisplay.className,
              "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-4 pt-0 text-[clamp(16px,5.6vw,30px)] font-extrabold italic leading-none outline-none placeholder:italic focus:border-b-2",
              hasEmailError
                ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43] focus:border-[#d56a61]"
                : "border-zinc-900 text-zinc-900 placeholder:text-zinc-900 focus:border-zinc-900",
            )}
            style={hasEmailError ? ({ color: "#df4e43", WebkitTextFillColor: "#df4e43" } as React.CSSProperties) : undefined}
            {...register("email")}
          />
          {errors.email ? <p className="mt-3 text-[20px] font-medium text-[#E44D3E]">{errors.email.message}</p> : null}
          {!errors.email && authErrorType === "account_not_found" ? (
            <p className="mt-3 text-[20px] font-medium text-[#E44D3E]">Ce compte n&apos;existe pas.</p>
          ) : null}
        </div>

        <div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Mot de passe"
            className={cn(
              playfairDisplay.className,
              "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-4 pt-0 text-[clamp(16px,5.6vw,30px)] font-extrabold italic leading-none outline-none placeholder:italic focus:border-b-2",
              hasPasswordError
                ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43] focus:border-[#d56a61]"
                : "border-zinc-900 text-zinc-900 placeholder:text-zinc-900 focus:border-zinc-900",
            )}
            style={hasPasswordError ? ({ color: "#df4e43", WebkitTextFillColor: "#df4e43" } as React.CSSProperties) : undefined}
            {...register("password")}
          />
          {errors.password ? <p className="mt-3 text-[20px] font-medium text-[#E44D3E]">{errors.password.message}</p> : null}
          {!errors.password && authErrorType === "wrong_password" ? (
            <p className="mt-3 text-[20px] font-medium text-[#E44D3E]">Mot de passe incorrect.</p>
          ) : null}
          <div className="mt-3 text-right">
            <Link href="/auth/forgot-password" className="text-[14px] font-medium text-zinc-600 underline">
              Mot de passe oublie ?
            </Link>
          </div>
        </div>

        {errorMessage && !authErrorType ? <p className="text-[20px] font-medium text-[#E44D3E]">{errorMessage}</p> : null}
      </form>
    </div>
  );
}
