"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { OtpInput } from "@/components/auth/OtpInput";
import { otpSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

export type SignUpVerifyFooterState = {
  field: string | null;
  submit: string | null;
  status: string | null;
};

type SignUpVerifyCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  onFooterStateChange?: (state: SignUpVerifyFooterState) => void;
};

const RESEND_SECONDS = 30;
const RATE_LIMIT_BACKOFF_SECONDS = 60;
const OTP_LENGTH = 8;

export function SignUpVerifyCore({
  formId,
  onCanContinueChange,
  onSubmittingChange,
  onFooterStateChange,
}: SignUpVerifyCoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();
  const email = useMemo(() => searchParams.get("email") ?? "", [searchParams]);
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
      const {
        error,
      } = await supabase.auth.getUser();

      if (!error) return;

      const normalized = (error.message ?? "").toLowerCase();
      if (normalized.includes("invalid refresh token") || normalized.includes("refresh token not found")) {
        await supabase.auth.signOut();
      }
    };

    void ensureSessionIsHealthy();
  }, [supabase]);

  useEffect(() => {
    if (!email) {
      setResendLockedUntil(null);
      setRemainingSeconds(0);
      return;
    }

    const storageKey = `segna:auth:verify:resend-until:${email}`;
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
  }, [email, sentAt]);

  useEffect(() => {
    if (!email || !resendLockedUntil) {
      setRemainingSeconds(0);
      return;
    }

    const storageKey = `segna:auth:verify:resend-until:${email}`;
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
  }, [email, resendLockedUntil]);

  const codeOk = otpSchema.safeParse({ code }).success;

  useEffect(() => {
    onCanContinueChange?.(codeOk);
  }, [codeOk, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    if (fieldError && otpSchema.safeParse({ code }).success) {
      setFieldError(null);
    }
  }, [code, fieldError]);

  const runVerifyOtp = async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    if (!email) {
      setErrorMessage("E-mail manquant. Recommencez l'inscription.");
      return;
    }

    setIsSubmitting(true);
    let error: { message?: string } | null = null;
    try {
      const result = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      error = result.error;
    } catch {
      error = { message: "Une erreur est survenue pendant la vérification." };
    } finally {
      setIsSubmitting(false);
    }

    if (error) {
      const normalizedMessage = (error.message ?? "").toLowerCase();
      if (normalizedMessage.includes("token has expired") || normalizedMessage.includes("invalid")) {
        setErrorMessage("Ce n'est pas le bon code.");
        return;
      }
      setErrorMessage("Code incorrect.");
      return;
    }

    router.replace("/auth/sign-up/password");
  };

  const onFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const parsed = otpSchema.safeParse({ code });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Code invalide.");
      return;
    }

    setFieldError(null);
    void runVerifyOtp();
  };

  const onResend = async () => {
    if (remainingSeconds > 0 || !email) return;
    setIsResending(true);
    setFieldError(null);
    setErrorMessage(null);
    setStatusMessage(null);

    let error: { message?: string } | null = null;
    try {
      const result = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
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
        window.localStorage.setItem(`segna:auth:verify:resend-until:${email}`, String(nextLockUntil));
        setErrorMessage("Vous avez demandé trop de codes. Réessayez dans 1 minute.");
        return;
      }

      setErrorMessage(error.message ?? "Erreur lors du renvoi du code.");
      return;
    }

    const nextLockUntil = Date.now() + RESEND_SECONDS * 1000;
    setResendLockedUntil(nextLockUntil);
    setRemainingSeconds(RESEND_SECONDS);
    window.localStorage.setItem(`segna:auth:verify:resend-until:${email}`, String(nextLockUntil));
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
          <span className="max-w-[min(100%,220px)] truncate font-bold text-black sm:max-w-[280px]" title={email || undefined}>
            {email || "—"}
          </span>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <Link
            href="/auth/sign-up/email"
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
              onClick={onResend}
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
