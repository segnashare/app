"use client";

import { Montserrat, Playfair_Display } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

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
  ageVisibleOnProfile?: boolean;
};

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "800",
});
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

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

function toBirthDate(day: string, month: string, year: string) {
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  return new Date(yearNumber, monthNumber - 1, dayNumber);
}

function getAgeFromBirthDate(birthDate: Date) {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  const hasNotHadBirthdayYet = monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate());
  if (hasNotHadBirthdayYet) age -= 1;
  return age;
}

export function OnboardingBirthCore({ formId, onCanContinueChange, ageVisibleOnProfile = true }: OnboardingBirthCoreProps) {
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
  const [showAgeModal, setShowAgeModal] = useState(false);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const placeholders = useMemo(() => ["d", "d", "m", "m", "y", "y", "y", "y"], []);

  const day = `${digits[0]}${digits[1]}`;
  const month = `${digits[2]}${digits[3]}`;
  const year = `${digits[4]}${digits[5]}${digits[6]}${digits[7]}`;
  const isDateValid = isValidBirthDate(day, month, year);

  useEffect(() => {
    onCanContinueChange?.(isDateValid && !isSubmitting);
  }, [isDateValid, isSubmitting, onCanContinueChange]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const values: BirthFormValues = { day, month, year };
    if (!isValidBirthDate(values.day, values.month, values.year)) {
      setErrorMessage("Merci d'indiquer une date valide.");
      return;
    }

    setShowAgeModal(true);
  };

  const onConfirmAge = async () => {
    setErrorMessage(null);
    const values: BirthFormValues = { day, month, year };

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
            visibility: ageVisibleOnProfile,
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
      p_current_step: "/onboarding/1",
      p_progress_json: { checkpoint: "/onboarding/birth" },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/1");
  };

  const birthDateForModal = isDateValid ? toBirthDate(day, month, year) : null;
  const ageForModal = birthDateForModal ? getAgeFromBirthDate(birthDateForModal) : null;
  const birthDateForModalLabel = birthDateForModal
    ? birthDateForModal.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <div className="mt-8 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-6">
        <div className="flex w-full min-w-0 items-end gap-[clamp(1px,0.5vw,4px)]">
          {digits.map((digit, index) => (
            <div key={`birth-slot-${index}`} className={cn("min-w-0 flex-1", (index === 2 || index === 4) && "ml-[clamp(3px,1vw,8px)]")}>
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
                  "mx-auto h-auto w-[82%] min-w-0 rounded-none border-0 border-b bg-transparent px-0 pb-3 pt-0 text-center text-[clamp(28px,4.8vw,44px)] font-extrabold leading-none outline-none placeholder:text-zinc-900/55 focus:border-b-2 md:w-full",
                  errorMessage
                    ? "border-[#d56a61] text-[#df4e43] placeholder:text-[#df4e43]/70 focus:border-[#d56a61]"
                    : "border-zinc-900 text-zinc-900 focus:border-zinc-900",
                )}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                onChange={(event) => {
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
        <p
          className={cn(
            montserrat.className,
            "max-w-[430px] text-[clamp(14px,2.6vw,18px)] font-medium leading-[1.2] tracking-[0.01em] text-[#000000]",
          )}
        >
          Cela nous permet de calculer l&apos;âge qui s&apos;affiche sur ton profil.
        </p>

        {errorMessage ? <p className="text-[clamp(12px,4.2vw,18px)] text-[#E44D3E]">{errorMessage}</p> : null}
      </form>

      {showAgeModal && birthDateForModal && ageForModal !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-md p-[clamp(12px,3vw,28px)]">
          <div className="w-[min(90vw,500px)] max-h-[min(88vh,640px)] overflow-hidden rounded-[clamp(16px,2.4vw,20px)] bg-white shadow-[0_14px_42px_rgba(0,0,0,0.18)]">
            <div className="min-h-[clamp(250px,52vw,360px)] px-[clamp(20px,4.6vw,36px)] pb-[clamp(26px,5.2vw,40px)] pt-[clamp(30px,6vw,48px)]">
              <h2 className={cn(playfairDisplay.className, "text-[clamp(30px,8vw,64px)] font-extrabold leading-[1.02] text-zinc-950")}>
                Tu as {ageForModal} ans
              </h2>
              <p className="mt-[clamp(8px,1.8vw,14px)] text-[clamp(14px,3.2vw,18px)] font-semibold leading-[1.15] text-zinc-900">
                Née {birthDateForModalLabel}
              </p>
              <p className="mt-[clamp(30px,6vw,42px)] text-[clamp(16px,4vw,24px)] font-semibold leading-[1.28] text-zinc-900">
                Confirme que ton âge est correct.
              </p>
              <p className="mt-[clamp(6px,1.4vw,12px)] text-[clamp(16px,4vw,24px)] leading-[1.28] text-zinc-900">
                Ensemble, faisons en sorte que notre communauté reste authentique.
              </p>
            </div>

            <div className="flex h-[clamp(68px,12vw,88px)] border-t border-zinc-200">
              <button
                type="button"
                className="h-full flex-1 text-[clamp(16px,3.6vw,24px)] font-medium text-zinc-800"
                onClick={() => setShowAgeModal(false)}
                disabled={isSubmitting}
              >
                Modifier
              </button>
              <div className="w-px bg-zinc-200" aria-hidden />
              <button
                type="button"
                className="h-full flex-1 text-[clamp(16px,3.6vw,24px)] font-semibold text-[#5E3023]"
                onClick={() => void onConfirmAge()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "..." : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
