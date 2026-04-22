"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/Input";
import { emailSchema } from "@/features/auth/lib/schemas";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { segnaPlayfairDisplay } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const playfairDisplay = segnaPlayfairDisplay;

type EmailFormValues = {
  email: string;
};

export type SignUpEmailAuthErrorState = {
  field: string | null;
  submit: string | null;
  showLoginLink: boolean;
};

type SignUpEmailCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
  onAuthErrorStateChange?: (state: SignUpEmailAuthErrorState) => void;
  onSubmittingChange?: (submitting: boolean) => void;
};

function nextVerifySentAtMs(): number {
  return Date.now();
}

/** Même taille / graisse que le placeholder « E-mail » (Montserrat). */
const MEASURE_EMPTY =
  "inline-block whitespace-pre font-segna-montserrat font-semibold not-italic tracking-tight text-[clamp(1.125rem,5vw,1.5rem)]";

/** Même taille / graisse que la valeur saisie (Playfair). */
const MEASURE_FILLED =
  "inline-block whitespace-pre font-segna-playfair font-extrabold tracking-tight text-[clamp(1.125rem,5vw,1.5rem)]";

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

export function SignUpEmailCore({
  formId,
  onCanContinueChange,
  onAuthErrorStateChange,
  onSubmittingChange,
}: SignUpEmailCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showLoginLink, setShowLoginLink] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: { email: "" },
  });

  const emailValue = watch("email");
  const emailOk = emailSchema.safeParse({ email: emailValue ?? "" }).success;

  useEffect(() => {
    onCanContinueChange?.(emailOk);
  }, [emailOk, onCanContinueChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  useEffect(() => {
    onAuthErrorStateChange?.({
      field: isSubmitted ? (errors.email?.message ?? null) : null,
      submit: submitError,
      showLoginLink,
    });
  }, [errors.email?.message, isSubmitted, submitError, showLoginLink, onAuthErrorStateChange]);

  const onSubmit = handleSubmit(async ({ email }) => {
    setSubmitError(null);
    setShowLoginLink(false);

    try {
      const response = await fetch("/api/auth/user-exists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, mode: "member" }),
      });
      const payload = (await response.json()) as { exists?: boolean };
      if (payload.exists) {
        setShowLoginLink(true);
        setSubmitError("Un compte existe déjà avec cette adresse e-mail.");
        return;
      }
    } catch {
      // If the check endpoint is temporarily unavailable, keep sign-up flow available.
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });

    if (error) {
      const rawMessage = typeof error.message === "string" ? error.message : "";
      const normalizedMessage = rawMessage.toLowerCase();
      if (normalizedMessage.includes("email rate limit exceeded") || normalizedMessage.includes("login.new_email")) {
        setSubmitError("Trop de tentatives. Attendez un peu avant de demander un nouvel e-mail.");
        console.error("[sign-up/email] Email rate limit exceeded", { email, error });
        return;
      }
      if (normalizedMessage.includes("error sending confirmation email")) {
        setSubmitError("Impossible d'envoyer l'e-mail pour le moment. Réessayez dans quelques instants.");
        console.error("[sign-up/email] Error sending confirmation email", { email, error });
        return;
      }
      setSubmitError("Une erreur est survenue. Réessayez.");
      console.error("[sign-up/email] OTP request failed", { email, error });
      return;
    }

    router.replace(`/auth/sign-up/verify?email=${encodeURIComponent(email)}&sentAt=${nextVerifySentAtMs()}`);
  });

  const hasEmailError = Boolean(isSubmitted && errors.email);

  const { ref: rhfEmailRef, onChange: rhfEmailOnChange, ...emailField } = register("email");

  const syncTextCenterPadding = useCallback(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.paddingLeft = "0px";
    const inner = node.offsetWidth;
    const raw = node.value;
    const display = raw.length > 0 ? raw : "E-mail";
    const measureCls = raw.length > 0 ? MEASURE_FILLED : MEASURE_EMPTY;
    const w = measureTextWidth(display, measureCls);
    const pad = Math.max(0, (inner - w) / 2);
    node.style.paddingLeft = `${pad}px`;
  }, []);

  useLayoutEffect(() => {
    syncTextCenterPadding();
    const node = inputRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      syncTextCenterPadding();
    });
    ro.observe(node);
    return () => {
      ro.disconnect();
    };
  }, [emailValue, syncTextCenterPadding]);

  return (
    <div className="flex w-full flex-col items-center">
      <form id={formId} onSubmit={onSubmit} noValidate className="flex w-full justify-center">
        <div className="w-full max-w-[min(100%,380px)] rounded-xl bg-[#f5f5f5] px-5 py-4">
          <Input
            id="email"
            type="email"
            placeholder="E-mail"
            autoComplete="email"
            dir="ltr"
            className={cn(
              playfairDisplay.className,
              "h-auto w-full rounded-none border-0 bg-transparent py-1 pr-0 text-left text-[clamp(1.125rem,5vw,1.5rem)] font-extrabold leading-tight tracking-tight text-black outline-none ring-0 focus:ring-0",
              "caret-zinc-900 [caret-width:2px]",
              "placeholder:font-segna-montserrat placeholder:font-semibold placeholder:not-italic placeholder:text-[#999999]",
              hasEmailError ? "placeholder:text-[#df4e43]" : null,
            )}
            {...emailField}
            onChange={(e) => {
              void rhfEmailOnChange(e);
              queueMicrotask(syncTextCenterPadding);
            }}
            ref={(el: HTMLInputElement | null) => {
              inputRef.current = el;
              rhfEmailRef(el);
            }}
          />
        </div>
      </form>
    </div>
  );
}
