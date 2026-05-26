"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const playfairDisplay = segnaPlayfairDisplay;

import { Input } from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { capitalizeFirstLetter } from "@/lib/strings/capitalizeFirstLetter";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type NameFormValues = {
  firstName: string;
  lastName: string;
};

type OnboardingNameCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (value: boolean) => void;
  /** Classes du `<form>` (ex. marges selon le shell). */
  formClassName?: string;
  redirectPath?: string;
  initialFirstName?: string;
  initialLastName?: string;
};




export function OnboardingNameCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  formClassName,
  redirectPath,
  initialFirstName,
  initialLastName,
}: OnboardingNameCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const rpcUntyped = async (fn: string, args?: Record<string, unknown>) =>
    (supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data?: unknown; error?: { message?: string } | null } | undefined>)(fn, args);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NameFormValues>({
    mode: "onChange",
    defaultValues: {
      firstName: "",
      lastName: "",
    },
  });

  const hasFirstNameError = Boolean(errors.firstName);
  const hasLastNameError = Boolean(errors.lastName);
  const canContinue = watch("firstName", "").trim().length >= 2 && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    if (typeof initialFirstName === "string") {
      setValue("firstName", initialFirstName);
    }
    if (typeof initialLastName === "string") {
      setValue("lastName", initialLastName);
    }
  }, [initialFirstName, initialLastName, setValue]);

  const onSubmit = handleSubmit(async ({ firstName, lastName }) => {
    setErrorMessage(null);

    const normalizedFirstName = capitalizeFirstLetter(firstName);
    const normalizedLastName = capitalizeFirstLetter(lastName);

    const settingsResult = await rpcUntyped("update_user_account_settings", {
      p_locale: null,
      p_timezone: null,
      p_first_name: normalizedFirstName,
      p_last_name: normalizedLastName || null,
      p_request_id: crypto.randomUUID(),
    });
    if (settingsResult?.error) {
      setErrorMessage(settingsResult.error.message ?? "Impossible d'enregistrer ton nom.");
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/2",
      p_progress_json: {
        checkpoint: "/onboarding/name",
      },
      p_request_id: crypto.randomUUID(),
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(redirectPath ?? "/onboarding/2");
  });

  const framedInputClass = (hasError: boolean) =>
    cn(
      playfairDisplay.className,
      "h-auto w-full rounded-none border-0 bg-transparent py-1 pr-0 text-left text-[clamp(1.125rem,5vw,1.5rem)] font-extrabold leading-tight tracking-tight text-black outline-none ring-0 focus:ring-0",
      "caret-zinc-900 [caret-width:2px]",
      "placeholder:font-segna-montserrat placeholder:font-semibold placeholder:not-italic placeholder:text-[#999999]",
      hasError ? "placeholder:text-[#df4e43]" : null,
    );

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className={cn(formClassName ?? "mt-10 flex w-full flex-col items-center gap-3 md:gap-4")}>
      <div className="w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
        <Input
          id="firstName"
          type="text"
          autoComplete="given-name"
          placeholder="Prénom"
          dir="ltr"
          className={framedInputClass(hasFirstNameError)}
          {...register("firstName", {
            validate: (value) => value.trim().length >= 2 || "Merci d'indiquer ton prénom.",
          })}
        />
      </div>

      <div className="w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
        <Input
          id="lastName"
          type="text"
          autoComplete="family-name"
          placeholder="Nom"
          dir="ltr"
          className={framedInputClass(hasLastNameError)}
          {...register("lastName")}
        />
      </div>

      {hasFirstNameError ? <p className={themeClassNames.onboarding.textes.erreurFormulaire}>Merci d&apos;indiquer ton prénom.</p> : null}
      {errorMessage ? <p className={themeClassNames.onboarding.textes.erreurFormulaire}>{errorMessage}</p> : null}
    </form>
  );
}
