"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Input } from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type WorkFormValues = {
  profession: string;
};

type OnboardingWorkCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingWorkCore({ formId, onCanContinueChange }: OnboardingWorkCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<WorkFormValues>({
    mode: "onChange",
    defaultValues: {
      profession: "",
    },
  });

  const hasProfessionError = Boolean(errors.profession);
  const canContinue = watch("profession", "").trim().length >= 2 && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = handleSubmit(async ({ profession }) => {
    setErrorMessage(null);
    const normalizedProfession = profession.trim();

    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/2",
      p_progress: {
        checkpoint: "/onboarding/work",
        profession: normalizedProfession,
      },
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/2");
  });

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="mt-9">
      <Input
        id="profession"
        type="text"
        autoComplete="organization-title"
        placeholder="Profession"
        className={cn(
          montserrat.className,
          "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-3 pt-0 text-[clamp(22px,5vw,34px)] font-medium italic leading-none outline-none placeholder:italic",
          hasProfessionError
            ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43]/70 focus:border-[#d56a61]"
            : "border-zinc-700 text-zinc-900 placeholder:text-zinc-300 focus:border-zinc-900",
        )}
        {...register("profession", {
          validate: (value) => value.trim().length >= 2 || "Merci d'indiquer ta profession.",
        })}
      />

      {hasProfessionError ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>Merci d&apos;indiquer ta profession.</p> : null}
      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </form>
  );
}
