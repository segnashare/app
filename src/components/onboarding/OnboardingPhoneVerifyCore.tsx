"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { OtpInput } from "@/components/auth/OtpInput";
import type { SignUpVerifyFooterState } from "@/components/auth/SignUpVerifyCore";
import { otpPhoneSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

type OnboardingPhoneVerifyCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  onFooterStateChange?: (state: SignUpVerifyFooterState) => void;
};

const RESEND_SECONDS = 30;
const RATE_LIMIT_BACKOFF_SECONDS = 60;
const OTP_LENGTH = 6;

function mapPhoneProviderError(message?: string): string {
  const normalized = (message ?? "").toLowerCase();
  if (normalized.includes("unable to get sms provider")) {
    return "Le fournisseur SMS n'est pas configuré sur le projet. Active Twilio dans Supabase (Auth > Phone).";
  }
  if (normalized.includes("rate limit")) {
    return "Tu as demandé trop de codes. Réessaie dans 1 minute.";
  }
  return message ?? "Erreur SMS temporaire. Réessaie dans un instant.";
}

function normalizeFrenchPhoneToE164(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return local.length === 9 ? `+33${local}` : null;
}

export function OnboardingPhoneVerifyCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  onFooterStateChange,
}: OnboardingPhoneVerifyCoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();
  const phone = useMemo(() => searchParams.get("phone") ?? "", [searchParams]);
  const sentAt = useMemo(() => {
    const raw = searchParams.get("sentAt");
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  const [code, setCode] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [resendLockedUntil, setResendLockedUntil] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    onFooterStateChange?.({
      field: fieldError,
      submit: errorMessage,
      status: statusMessage,
    });
  }, [fieldError, errorMessage, statusMessage, onFooterStateChange]);

  useEffect(() => {
    const ensureSessionIsHealthy = async () => {
      const { error } = await supabase.auth.getUser();
      if (!error) return;
      const normalized = (error.message ?? "").toLowerCase();
      if (normalized.includes("invalid refresh token") || normalized.includes("refresh token not found")) {
        await supabase.auth.signOut();
      }
    };
    void ensureSessionIsHealthy();
  }, [supabase]);

  useEffect(() => {
    if (!phone) {
      setResendLockedUntil(null);
      setRemainingSeconds(0);
      return;
    }

    const storageKey = `segna:onboarding:phone-verify:resend-until:${phone}`;
    const now = Date.now();
    const storedUntilRaw = window.localStorage.getItem(storageKey);
    const storedUntil = storedUntilRaw ? Number(storedUntilRaw) : Number.NaN;
    const isStoredValid = Number.isFinite(storedUntil) && storedUntil > now;

    if (isStoredValid) {
      setResendLockedUntil(storedUntil);
      return;
    }

    if (sentAt) {
      const initialUntil = sentAt + RESEND_SECONDS * 1000;
      if (initialUntil > now) {
        window.localStorage.setItem(storageKey, String(initialUntil));
        setResendLockedUntil(initialUntil);
        return;
      }
    }

    window.localStorage.removeItem(storageKey);
    setResendLockedUntil(null);
    setRemainingSeconds(0);
  }, [phone, sentAt]);

  useEffect(() => {
    if (!phone || !resendLockedUntil) {
      setRemainingSeconds(0);
      return;
    }

    const storageKey = `segna:onboarding:phone-verify:resend-until:${phone}`;
    const syncRemaining = () => {
      const seconds = Math.max(0, Math.ceil((resendLockedUntil - Date.now()) / 1000));
      setRemainingSeconds(seconds);
      if (seconds <= 0) {
        window.localStorage.removeItem(storageKey);
        setResendLockedUntil(null);
      }
    };

    syncRemaining();
    const id = window.setInterval(syncRemaining, 1000);
    return () => window.clearInterval(id);
  }, [phone, resendLockedUntil]);

  const codeOk = otpPhoneSchema.safeParse({ code }).success;

  useEffect(() => {
    onCanContinueChange?.(codeOk);
  }, [codeOk, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    if (fieldError && otpPhoneSchema.safeParse({ code }).success) {
      setFieldError(null);
    }
  }, [code, fieldError]);

  const runVerify = async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    const normalizedPhone = normalizeFrenchPhoneToE164(phone);
    if (!normalizedPhone) {
      setErrorMessage("Numéro invalide. Reviens à l'étape précédente.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token: code,
        type: "phone_change",
      });
      if (verifyError) {
        const normalizedMessage = (verifyError.message ?? "").toLowerCase();
        if (normalizedMessage.includes("token has expired") || normalizedMessage.includes("invalid")) {
          setErrorMessage("Ce n'est pas le bon code.");
          return;
        }
        if (normalizedMessage.includes("unable to get sms provider")) {
          setErrorMessage(mapPhoneProviderError(verifyError.message));
          return;
        }
        setErrorMessage("Code incorrect.");
        return;
      }

      const { error: phoneError } = await supabase.rpc("set_user_phone_verified", {
        p_phone_e164: normalizedPhone,
        p_request_id: crypto.randomUUID(),
      });
      if (phoneError) {
        setErrorMessage(phoneError.message);
        return;
      }

      const { error: profileError } = await supabase.rpc("update_user_profile_public", {
        p_profile_json: {
          profile_data: {
            phone_e164: normalizedPhone,
            phone_code_verified: true,
          },
        },
        p_request_id: crypto.randomUUID(),
      });
      if (profileError) {
        setErrorMessage(profileError.message);
        return;
      }

      const { error } = await supabase.rpc("upsert_onboarding_progress", {
        p_current_step: "/onboarding/name",
        p_progress_json: { checkpoint: "/onboarding/phone/verify" },
        p_request_id: crypto.randomUUID(),
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      router.push("/onboarding/name");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const parsed = otpPhoneSchema.safeParse({ code });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Code invalide.");
      return;
    }

    setFieldError(null);
    void runVerify();
  };

  const onResend = async () => {
    if (remainingSeconds > 0) return;
    const normalizedPhone = normalizeFrenchPhoneToE164(phone);
    if (!normalizedPhone) return;

    setIsResending(true);
    setFieldError(null);
    setErrorMessage(null);
    setStatusMessage(null);

    const storageKey = `segna:onboarding:phone-verify:resend-until:${phone}`;
    let error: { message?: string } | null = null;
    try {
      const result = await supabase.auth.updateUser({
        phone: normalizedPhone,
      });
      error = result.error;
    } catch {
      error = { message: "Impossible de renvoyer le code pour le moment." };
    }

    setIsResending(false);

    if (error) {
      const isRateLimited = /rate limit/i.test(error.message ?? "");
      if (isRateLimited) {
        const nextLockUntil = Date.now() + RATE_LIMIT_BACKOFF_SECONDS * 1000;
        setResendLockedUntil(nextLockUntil);
        setRemainingSeconds(RATE_LIMIT_BACKOFF_SECONDS);
        window.localStorage.setItem(storageKey, String(nextLockUntil));
        setErrorMessage(mapPhoneProviderError(error.message));
        return;
      }
      setErrorMessage(mapPhoneProviderError(error.message));
      return;
    }

    const nextLockUntil = Date.now() + RESEND_SECONDS * 1000;
    setResendLockedUntil(nextLockUntil);
    setRemainingSeconds(RESEND_SECONDS);
    window.localStorage.setItem(storageKey, String(nextLockUntil));
    setStatusMessage("Nouveau code envoyé.");
  };

  return (
    <div className={cn(montserrat.className, "flex w-full flex-col items-center")}>
      <form id={formId} onSubmit={onFormSubmit} noValidate className="mt-1.5 flex w-full flex-col items-center gap-2 md:mt-2 md:gap-2.5">
        <div className="w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-4 py-4">
          <OtpInput
            value={code}
            onChange={setCode}
            length={OTP_LENGTH}
            className="w-full min-w-0 justify-center gap-[clamp(6px,1.5vw,12px)]"
            itemClassName="min-w-0 flex-1"
            inputClassName={cn(
              montserrat.className,
              "h-[clamp(42px,9.5vw,50px)] w-full min-w-0 max-w-[2.75rem] border-0 border-b-[1.5px] border-zinc-400 bg-transparent text-center text-[clamp(1.35rem,5.4vw,1.85rem)] font-bold leading-none text-black caret-transparent outline-none focus:border-zinc-900",
            )}
          />
        </div>

        <p className="flex w-full max-w-[min(100%,380px)] min-w-0 flex-wrap items-baseline justify-center gap-x-1 gap-y-0.5 text-center text-[13px] font-semibold leading-tight text-[#999999] sm:text-[14px]">
          <span className="shrink-0">Code envoyé à :</span>
          <span className="max-w-[min(100%,220px)] truncate font-bold text-black sm:max-w-[280px]" title={phone || undefined}>
            {phone || "—"}
          </span>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <Link
            href="/onboarding/phone"
            className="shrink-0 font-semibold text-black underline decoration-zinc-400 underline-offset-2 hover:text-zinc-700"
          >
            Modifier
          </Link>
        </p>

        <p className="w-full max-w-[min(100%,380px)] text-center text-[14px] font-semibold text-[#999999]">
          {remainingSeconds > 0 ? (
            <>Renvoyer le code dans {remainingSeconds}s.</>
          ) : (
            <button
              type="button"
              className="font-semibold text-black underline decoration-zinc-400 underline-offset-2 hover:text-zinc-700"
              onClick={() => void onResend()}
              disabled={isResending}
            >
              {isResending ? "Envoi…" : "Renvoyer le code"}
            </button>
          )}
        </p>
      </form>
    </div>
  );
}
