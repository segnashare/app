"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { OtpInput } from "@/components/auth/OtpInput";
import { otpSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SignUpVerifyCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const RESEND_SECONDS = 30;
const RATE_LIMIT_BACKOFF_SECONDS = 60;
const OTP_LENGTH = 8;
const SEGNA_BROWN = "#5E3023";

export function SignUpVerifyCore({ formId, onCanContinueChange }: SignUpVerifyCoreProps) {
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

  const isCodeValid = otpSchema.safeParse({ code }).success;
  useEffect(() => {
    onCanContinueChange?.(isCodeValid && !isSubmitting);
  }, [isCodeValid, isSubmitting, onCanContinueChange]);

  const onVerify = async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    const parsed = otpSchema.safeParse({ code });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Code invalide");
      return;
    }

    if (!email) {
      setErrorMessage("Email manquant. Recommence l'inscription.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    setIsSubmitting(false);

    if (error) {
      const normalizedMessage = error.message.toLowerCase();
      if (normalizedMessage.includes("token has expired") || normalizedMessage.includes("invalid")) {
        setErrorMessage("Ce n'est pas le bon code.");
        return;
      }
      setErrorMessage("Code incorrect.");
      return;
    }

    router.push("/auth/sign-up/password");
  };

  const onResend = async () => {
    if (remainingSeconds > 0 || !email) return;
    setIsResending(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });

    setIsResending(false);

    if (error) {
      const isRateLimited = /rate limit/i.test(error.message);
      if (isRateLimited) {
        const nextLockUntil = Date.now() + RATE_LIMIT_BACKOFF_SECONDS * 1000;
        setResendLockedUntil(nextLockUntil);
        setRemainingSeconds(RATE_LIMIT_BACKOFF_SECONDS);
        window.localStorage.setItem(`segna:auth:verify:resend-until:${email}`, String(nextLockUntil));
        setErrorMessage("Tu as demandé trop de codes. Réessaie dans 1 minute.");
        return;
      }

      setErrorMessage(error.message);
      return;
    }

    const nextLockUntil = Date.now() + RESEND_SECONDS * 1000;
    setResendLockedUntil(nextLockUntil);
    setRemainingSeconds(RESEND_SECONDS);
    window.localStorage.setItem(`segna:auth:verify:resend-until:${email}`, String(nextLockUntil));
    setStatusMessage("Nouveau code envoyé.");
  };

  return (
    <div className="mt-6 w-full">
      <div className="space-y-2">
        <p className="text-[16px] text-zinc-400">Code envoyé à :</p>
        <div className="flex items-end gap-2 text-[16px] font-bold leading-[1.35] text-zinc-400">
          <p className="max-w-[290px] break-all">{email || "email@example.com"}</p>
          <span aria-hidden className="text-[16px] leading-none text-zinc-400">
            ·
          </span>
          <Link href="/auth/sign-up/email" className="text-[16px] font-bold leading-none" style={{ color: SEGNA_BROWN }}>
            Modifier
          </Link>
        </div>
      </div>

      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void onVerify();
        }}
        className="mt-10 space-y-8"
      >
        <OtpInput
          value={code}
          onChange={setCode}
          length={OTP_LENGTH}
          className="w-full min-w-0 !justify-between gap-[clamp(4px,1.2vw,10px)]"
          itemClassName="min-w-0 flex-1"
          inputClassName="h-[clamp(50px,8vw,62px)] w-full min-w-0 text-[clamp(26px,5.4vw,38px)] font-bold playfair-display"
        />

        {errorMessage ? <p className="text-[clamp(12px,4.2vw,18px)] text-[#E44D3E]">{errorMessage}</p> : null}
        {statusMessage ? <p className="text-sm text-emerald-700">{statusMessage}</p> : null}

        <p className="text-[clamp(12px,4.2vw,18px)]" style={{ color: SEGNA_BROWN }}>
          {remainingSeconds > 0 ? (
            <>Renvoyer le code dans {remainingSeconds}s.</>
          ) : (
            <button
              type="button"
              className="text-[clamp(12px,4.2vw,16px)] underline"
              style={{ color: SEGNA_BROWN }}
              onClick={onResend}
              disabled={isResending}
            >
              {isResending ? "Renvoi..." : "Renvoyer le code"}
            </button>
          )}
        </p>
      </form>
    </div>
  );
}
