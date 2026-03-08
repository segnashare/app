"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AuthScreen } from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { signInSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SignInFormValues = {
  email: string;
  password: string;
};

export default function SignInPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const redirectIfAlreadySignedIn = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return;

      const { data } = await supabase
        .from("onboarding_sessions")
        .select("current_step, status")
        .eq("user_id", session.user.id)
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
    formState: { errors, isSubmitting },
  } = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
  });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding");
  });

  return (
    <AuthScreen
      title="Se connecter"
      description="Entre ton email et ton mot de passe."
      footer={
        <>
          Pas encore de compte ?{" "}
          <Link href="/auth/sign-up/email" className="font-semibold text-zinc-700">
            S&apos;inscrire
          </Link>
        </>
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

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium text-zinc-600">
            Mot de passe
          </label>
          <Input id="password" type="password" placeholder="********" {...register("password")} />
          {errors.password ? (
            <p className="text-xs text-[#E44D3E]">{errors.password.message}</p>
          ) : null}
        </div>

        <div className="text-right">
          <Link href="/auth/forgot-password" className="text-xs font-medium text-zinc-600 underline">
            Mot de passe oublie ?
          </Link>
        </div>

        {errorMessage ? <p className="text-xs text-[#E44D3E]">{errorMessage}</p> : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Connexion..." : "Continuer"}
        </Button>
      </form>
    </AuthScreen>
  );
}
