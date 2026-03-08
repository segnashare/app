"use client";

import { Playfair_Display } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
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
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });

    if (error) {
      const normalizedMessage = error.message.toLowerCase();
      if (normalizedMessage.includes("email rate limit exceeded")) {
        console.error("[sign-up/email] Email rate limit exceeded", { email, error });
        return;
      }
      if (normalizedMessage.includes("error sending confirmation email")) {
        console.error("[sign-up/email] Error sending confirmation email", { email, error });
        return;
      }
      console.error("[sign-up/email] OTP request failed", { email, error });
      return;
    }

    router.push(`/auth/sign-up/verify?email=${encodeURIComponent(email)}&sentAt=${Date.now()}`);
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
      </form>
    </div>
  );
}
