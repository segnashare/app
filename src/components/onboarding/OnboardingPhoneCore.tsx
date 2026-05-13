"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Input } from "@/components/ui/Input";
import { normalizeFrenchLocalNumber } from "@/lib/phone/fr-mobile";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;
const DUPLICATE_PHONE_ONBOARDING_EXCEPTION_E164 = "+33781774735";

type PhoneFormValues = {
  phoneLocal: string;
};

export type OnboardingPhoneAuthErrorState = {
  field: string | null;
  submit: string | null;
};

type OnboardingPhoneCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onAuthErrorStateChange?: (state: OnboardingPhoneAuthErrorState) => void;
  onSubmittingChange?: (value: boolean) => void;
};

/** Même taille / graisse que le champ (Montserrat, valeur + placeholder). */
const MEASURE_PHONE =
  "inline-block whitespace-pre font-segna-montserrat font-semibold not-italic leading-none text-[clamp(1.05rem,4.2vw,1.35rem)]";

function measureTextWidth(text: string, measureClasses: string): number {
  const span = document.createElement("span");
  span.className = measureClasses;
  span.textContent = text;
  span.setAttribute("aria-hidden", "true");
  Object.assign(span.style, {
    position: "absolute",
    left: "-9999px",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.appendChild(span);
  const w = span.getBoundingClientRect().width;
  span.remove();
  return w;
}

function mapPhoneProviderError(message?: string): string {
  const normalized = (message ?? "").toLowerCase();
  if (normalized.includes("unable to get sms provider")) {
    return "Le fournisseur SMS n'est pas configuré sur le projet. Active Twilio dans Supabase (Auth > Phone).";
  }
  if (normalized.includes("rate limit")) {
    return "Trop de tentatives. Réessaie dans 1 minute.";
  }
  return message ?? "Impossible d'envoyer le code SMS.";
}

export function OnboardingPhoneCore({
  formId,
  onCanContinueChange,
  onAuthErrorStateChange,
  onSubmittingChange,
}: OnboardingPhoneCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<PhoneFormValues>({
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: { phoneLocal: "" },
  });

  const phoneLocalValue = watch("phoneLocal");
  const nationalNumber = normalizeFrenchLocalNumber(phoneLocalValue ?? "");
  const hasPhoneError = Boolean(isSubmitted && errors.phoneLocal);
  const canContinue = nationalNumber.length === 9 && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    onAuthErrorStateChange?.({
      field: isSubmitted ? (errors.phoneLocal?.message ?? null) : null,
      submit: errorMessage,
    });
  }, [errors.phoneLocal?.message, errorMessage, isSubmitted, onAuthErrorStateChange]);

  const onSubmit = handleSubmit(async ({ phoneLocal }) => {
    setErrorMessage(null);
    const normalizedPhone = `+33${normalizeFrenchLocalNumber(phoneLocal)}`;
    const isDuplicatePhoneException = normalizedPhone === DUPLICATE_PHONE_ONBOARDING_EXCEPTION_E164;

    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser();
    if (getUserError || !user) {
      setErrorMessage("Session invalide. Reconnecte-toi puis réessaie.");
      return;
    }

    const { data: phoneOk, error: phoneAvailErr } = await supabase.rpc("phone_available_for_user_change", {
      p_phone: normalizedPhone,
      p_user_id: user.id,
    });
    if (phoneAvailErr) {
      setErrorMessage(phoneAvailErr.message ?? "Impossible de vérifier le numéro.");
      return;
    }
    if (phoneOk !== true && !isDuplicatePhoneException) {
      setErrorMessage("Ce numéro de téléphone est déjà utilisé par un autre compte.");
      return;
    }

    if (isDuplicatePhoneException) {
      const { error } = await supabase.rpc("upsert_onboarding_progress", {
        p_current_step: "/onboarding/name",
        p_progress_json: {
          checkpoint: "/onboarding/phone",
          duplicate_phone_exception: true,
          skipped_phone: true,
        },
        p_request_id: crypto.randomUUID(),
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      router.push("/onboarding/name");
      return;
    }

    const { error: otpError } = await supabase.auth.updateUser({
      phone: normalizedPhone,
    });
    if (otpError) {
      setErrorMessage(mapPhoneProviderError(otpError.message));
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/phone/verify",
      p_progress_json: { checkpoint: "/onboarding/phone" },
      p_request_id: crypto.randomUUID(),
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(
      `/onboarding/phone/verify?phone=${encodeURIComponent(phoneLocal.trim())}&sentAt=${Date.now()}`,
    );
  });

  const { ref: rhfPhoneRef, onChange: registerPhoneOnChange, ...phoneLocalField } = register("phoneLocal", {
    validate: (value) => normalizeFrenchLocalNumber(value).length === 9 || "Merci d'indiquer un numéro valide.",
  });

  const syncPhoneTextCenterPadding = useCallback(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.paddingLeft = "0px";
    const inner = node.offsetWidth;
    const raw = node.value;
    const display = raw.length > 0 ? raw : "Numéro de téléphone";
    const w = measureTextWidth(display, MEASURE_PHONE);
    const pad = Math.max(0, (inner - w) / 2);
    node.style.paddingLeft = `${pad}px`;
  }, []);

  useLayoutEffect(() => {
    syncPhoneTextCenterPadding();
    const node = inputRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      syncPhoneTextCenterPadding();
    });
    ro.observe(node);
    return () => {
      ro.disconnect();
    };
  }, [phoneLocalValue, syncPhoneTextCenterPadding]);

  return (
    <div className={cn(montserrat.className, "flex w-full flex-col items-center")}>
      <form id={formId} className="w-full max-w-[min(100%,380px)]" onSubmit={onSubmit} noValidate>
        <div className="w-full rounded-xl bg-[#f5f5f5] px-5 py-4">
          <Input
            id="phoneLocal"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="tel-national"
            placeholder="Numéro de téléphone"
            maxLength={10}
            dir="ltr"
            className={cn(
              "h-auto w-full rounded-none border-0 bg-transparent py-1 pr-0 text-left text-[clamp(1.05rem,4.2vw,1.35rem)] font-semibold leading-none text-zinc-900 shadow-none outline-none ring-0 focus-visible:ring-0",
              "caret-zinc-900 [caret-width:2px]",
              "placeholder:font-semibold placeholder:text-[#999999]",
              hasPhoneError ? "text-[#df4e43] placeholder:text-[#df4e43]" : "",
            )}
            {...phoneLocalField}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              e.target.value = digits;
              registerPhoneOnChange(e);
              queueMicrotask(syncPhoneTextCenterPadding);
            }}
            ref={(el: HTMLInputElement | null) => {
              inputRef.current = el;
              rhfPhoneRef(el);
            }}
          />
        </div>
      </form>
    </div>
  );
}
