"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Input } from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type PhoneFormValues = {
  phoneLocal: string;
};

type OnboardingPhoneCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

function normalizeFrenchLocalNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("0") ? digits.slice(1) : digits;
}

export function OnboardingPhoneCore({ formId, onCanContinueChange }: OnboardingPhoneCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PhoneFormValues>({
    mode: "onChange",
  });

  const nationalNumber = normalizeFrenchLocalNumber(watch("phoneLocal", ""));
  const hasPhoneError = Boolean(errors.phoneLocal);
  const canContinue = nationalNumber.length === 9 && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = handleSubmit(async ({ phoneLocal }) => {
    setErrorMessage(null);
    const normalizedPhone = `+33${normalizeFrenchLocalNumber(phoneLocal)}`;

    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/phone/verify",
      p_progress: { checkpoint: "/onboarding/phone", phone: normalizedPhone },
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(`/onboarding/phone/verify?phone=${encodeURIComponent(phoneLocal.trim())}`);
  });

  return (
    <div className="mt-8 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate>
        <div className="flex items-end gap-4">
          <div className="w-[28%] min-w-[92px] border-b border-zinc-900 pb-2">
            <p className={cn(montserrat.className, "text-[clamp(28px,4vw,38px)] font-semibold leading-none text-zinc-900")}>🇫🇷 +33</p>
          </div>
          <Input
            id="phoneLocal"
            type="tel"
            placeholder=""
            autoComplete="tel"
            maxLength={10}
            className={cn(
              montserrat.className,
              "h-auto w-[11ch] max-w-[11ch] rounded-none border-0 border-b bg-transparent px-0 pb-2 pt-0 text-[clamp(28px,4vw,36px)] font-semibold leading-none outline-none focus:border-b-2",
              hasPhoneError
                ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43] focus:border-[#d56a61]"
                : "border-zinc-900 text-zinc-900 placeholder:text-zinc-900 focus:border-zinc-900",
            )}
            {...register("phoneLocal", {
              validate: (value) => normalizeFrenchLocalNumber(value).length === 9 || "Merci d'indiquer un numéro valide.",
            })}
          />
        </div>

        {hasPhoneError ? <p className="ml-[calc(30%+1.5rem)] mt-3 text-[20px] font-medium text-[#E44D3E]">Merci d&apos;indiquer un numéro valide.</p> : null}

        <p className={cn(montserrat.className, "mt-6 max-w-[430px] text-[clamp(14px,2.6vw,18px)] font-medium leading-[normal] tracking-[0] text-[#AAAAAA]")}>
          Segna t&apos;enverra un SMS avec un code de vérification. Des frais de messagerie ou de consommation de données peuvent
          s&apos;appliquer.
        </p>
        {errorMessage ? <p className="mt-3 text-[20px] font-medium text-[#E44D3E]">{errorMessage}</p> : null}
      </form>
    </div>
  );
}
