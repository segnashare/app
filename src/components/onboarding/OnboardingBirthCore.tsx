"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
const playfairDisplay = segnaPlayfairDisplay;

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type BirthFormValues = {
  day: string;
  month: string;
  year: string;
};

type OnboardingBirthCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (value: boolean) => void;
  /** Remonte le message d’erreur pour affichage sous le CTA (layout centré). */
  onFooterErrorChange?: (message: string | null) => void;
  /** Classes du conteneur racine (ex. marges selon le shell). */
  formClassName?: string;
  redirectPath?: string;
  initialBirthDate?: string;
};

function clampDigits(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function isValidBirthDate(day: string, month: string, year: string) {
  if (day.length !== 2 || month.length !== 2 || year.length !== 4) return false;

  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  const nowYear = new Date().getFullYear();

  if (!Number.isInteger(dayNumber) || !Number.isInteger(monthNumber) || !Number.isInteger(yearNumber)) return false;
  if (yearNumber < 1900 || yearNumber > nowYear) return false;
  if (monthNumber < 1 || monthNumber > 12) return false;

  const candidate = new Date(yearNumber, monthNumber - 1, dayNumber);
  return (
    candidate.getFullYear() === yearNumber &&
    candidate.getMonth() === monthNumber - 1 &&
    candidate.getDate() === dayNumber
  );
}

export function OnboardingBirthCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  onFooterErrorChange,
  formClassName,
  redirectPath,
  initialBirthDate,
}: OnboardingBirthCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const rpcUntyped = async (fn: string, args?: Record<string, unknown>) =>
    (supabase.rpc as unknown as (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data?: unknown; error?: { message?: string } | null } | undefined>)(fn, args);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", "", "", ""]);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const placeholders = useMemo(() => ["d", "d", "m", "m", "y", "y", "y", "y"], []);

  const day = `${digits[0]}${digits[1]}`;
  const month = `${digits[2]}${digits[3]}`;
  const year = `${digits[4]}${digits[5]}${digits[6]}${digits[7]}`;
  const isDateValid = isValidBirthDate(day, month, year);

  useEffect(() => {
    onCanContinueChange?.(isDateValid && !isSubmitting);
  }, [isDateValid, isSubmitting, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    onFooterErrorChange?.(errorMessage);
  }, [errorMessage, onFooterErrorChange]);

  useEffect(() => {
    if (!initialBirthDate || !/^\d{4}-\d{2}-\d{2}$/.test(initialBirthDate)) return;
    const [yearValue, monthValue, dayValue] = initialBirthDate.split("-");
    const nextDigits = [dayValue[0] ?? "", dayValue[1] ?? "", monthValue[0] ?? "", monthValue[1] ?? "", yearValue[0] ?? "", yearValue[1] ?? "", yearValue[2] ?? "", yearValue[3] ?? ""];
    setDigits(nextDigits);
  }, [initialBirthDate]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const values: BirthFormValues = { day, month, year };
    if (!isValidBirthDate(values.day, values.month, values.year)) {
      setErrorMessage("Merci d'indiquer une date valide.");
      return;
    }

    setIsSubmitting(true);
    const isoDate = `${values.year}-${values.month}-${values.day}`;
    const birthResult = await rpcUntyped("set_user_birth_date", {
      p_birth_date: isoDate,
      p_request_id: crypto.randomUUID(),
    });
    if (birthResult?.error) {
      setIsSubmitting(false);
      setErrorMessage(birthResult.error.message ?? "Impossible d'enregistrer ta date de naissance.");
      return;
    }

    const { error: profileError } = await supabase.rpc("update_user_profile_public", {
      p_profile_json: {
        profile_data: {
          birth_date: isoDate,
          age: {
            visibility: true,
          },
        },
      },
      p_request_id: crypto.randomUUID(),
    });
    if (profileError) {
      setIsSubmitting(false);
      setErrorMessage(profileError.message);
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/size",
      p_progress_json: { checkpoint: "/onboarding/birth" },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(redirectPath ?? "/onboarding/size");
  };

  return (
    <div className={cn(formClassName ?? "mt-8 w-full")}>
      <form id={formId} onSubmit={onSubmit} noValidate className="flex w-full flex-col items-center gap-5">
        <div className="mx-auto w-fit max-w-full rounded-xl bg-[#f5f5f5] px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-6">
          <div className="flex min-w-0 items-end justify-center gap-[clamp(1px,0.45vw,3px)] md:gap-1.5">
            {digits.map((digit, index) => (
              <div
                key={`birth-slot-${index}`}
                className={cn(
                  "min-w-0 shrink-0 w-[clamp(24px,6.8vw,36px)] md:w-[clamp(36px,4.8vw,47px)]",
                  (index === 2 || index === 4) && "ml-[clamp(10px,3.5vw,24px)] md:ml-[clamp(12px,2.2vw,26px)]",
                )}
              >
                <input
                  id={`birth-slot-${index + 1}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete={index === 0 ? "bday-day" : "off"}
                  placeholder={placeholders[index]}
                  maxLength={1}
                  value={digit}
                  className={cn(
                    playfairDisplay.className,
                    "mx-auto h-auto w-[78%] min-w-0 rounded-none border-0 border-b-[1.5px] border-zinc-400 bg-transparent px-0 pb-2 pt-0 text-center text-[clamp(22px,4.2vw,38px)] font-extrabold leading-none outline-none focus:border-zinc-900 md:w-full md:text-[clamp(26px,3.2vw,40px)]",
                    "placeholder:font-segna-montserrat placeholder:font-semibold placeholder:not-italic placeholder:text-[#999999]",
                    errorMessage
                      ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43]/80 focus:border-[#d56a61]"
                      : "text-zinc-900",
                  )}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                onChange={(event) => {
                  setErrorMessage(null);
                  const nextDigit = clampDigits(event.target.value, 1);
                  setDigits((previous) => {
                    const next = [...previous];
                    next[index] = nextDigit;
                    return next;
                  });
                  if (nextDigit && index < 7) inputRefs.current[index + 1]?.focus();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                    return;
                  }
                  if (event.key === "Backspace" && !digits[index] && index > 0) {
                    inputRefs.current[index - 1]?.focus();
                  }
                }}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 8);
                  if (!pasted) return;

                  setErrorMessage(null);
                  event.preventDefault();
                  const next = ["", "", "", "", "", "", "", ""];
                  for (let i = 0; i < pasted.length; i += 1) {
                    next[i] = pasted[i] ?? "";
                  }
                  setDigits(next);
                  inputRefs.current[Math.min(pasted.length, 8) - 1]?.focus();
                }}
                />
              </div>
            ))}
          </div>
        </div>

      </form>

    </div>
  );
}
