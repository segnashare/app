"use client";

import { Montserrat, Playfair_Display } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Input } from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type NameFormValues = {
  firstName: string;
  lastName: string;
};

type OnboardingNameCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});
const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});

export function OnboardingNameCore({ formId, onCanContinueChange }: OnboardingNameCoreProps) {
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

  const onSubmit = handleSubmit(async ({ firstName, lastName }) => {
    setErrorMessage(null);

    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();

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
      p_current_step: "/onboarding/birth",
      p_progress_json: {
        checkpoint: "/onboarding/name",
      },
      p_request_id: crypto.randomUUID(),
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/birth");
  });

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="mt-10 space-y-8">
      <div>
        <Input
          id="firstName"
          type="text"
          autoComplete="given-name"
          placeholder="Prénom"
          className={cn(
            playfairDisplay.className,
            "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-4 pt-0 text-[clamp(16px,5.6vw,30px)] font-extrabold italic leading-none outline-none placeholder:italic focus:border-b-2",
            hasFirstNameError
              ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43] focus:border-[#d56a61]"
              : "border-zinc-900 text-zinc-900 placeholder:text-zinc-900 focus:border-zinc-900",
          )}
          {...register("firstName", {
            validate: (value) => value.trim().length >= 2 || "Merci d'indiquer ton prenom.",
          })}
        />
      </div>

      <div>
        <Input
          id="lastName"
          type="text"
          autoComplete="family-name"
          placeholder="Nom"
          className={cn(
            playfairDisplay.className,
            "h-auto rounded-none border-0 border-b bg-transparent px-0 pb-4 pt-0 text-[clamp(16px,5.6vw,30px)] font-extrabold italic leading-none outline-none placeholder:italic focus:border-b-2",
            hasLastNameError
              ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43] focus:border-[#d56a61]"
              : "border-zinc-900 text-zinc-900 placeholder:text-zinc-900 focus:border-zinc-900",
          )}
          {...register("lastName")}
        />
        <p
          className={cn(
            montserrat.className,
            themeClassNames.onboarding.textes.helperMuted,
            themeClassNames.onboarding.textes.helperTailleFluide,
            themeClassNames.onboarding.shell.largeurMaxDeuxTiersViewport,
            "mt-3",
          )}
        >
          Le nom de famille est facultatif et ne sera communique qu&apos;a tes matchs.
        </p>
      </div>

      {hasFirstNameError ? <p className={themeClassNames.onboarding.textes.erreurFormulaire}>Merci d&apos;indiquer ton prenom.</p> : null}
      {errorMessage ? <p className={themeClassNames.onboarding.textes.erreurFormulaire}>{errorMessage}</p> : null}
    </form>
  );
}
