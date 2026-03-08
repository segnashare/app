"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { OtpInput } from "@/components/auth/OtpInput";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OnboardingPhoneVerifyCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const OTP_LENGTH = 6;
const SEGNA_BROWN = "#5E3023";

export function OnboardingPhoneVerifyCore({ formId, onCanContinueChange }: OnboardingPhoneVerifyCoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();
  const phone = useMemo(() => searchParams.get("phone") ?? "", [searchParams]);

  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isCodeValid = code.length === OTP_LENGTH;
  useEffect(() => {
    onCanContinueChange?.(isCodeValid && !isSubmitting);
  }, [isCodeValid, isSubmitting, onCanContinueChange]);

  const onVerify = async () => {
    setErrorMessage(null);

    if (!/^\d{6}$/.test(code)) {
      setErrorMessage("Le code doit contenir 6 chiffres.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/name",
      p_progress: { checkpoint: "/onboarding/phone/verify", phone, phone_code_verified: true },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/name");
  };

  return (
    <div className="mt-6 w-full">
      <div className="space-y-2">
        <div className="flex items-baseline gap-3 text-[clamp(14px,2.6vw,20px)] font-bold leading-[4] text-zinc-400">
          <p className="max-w-[290px] break-all">Envoyé à {phone || "07 00 00 00 00"}</p>
          <span aria-hidden className="text-[22px] leading-none text-zinc-400">
            ·
          </span>
          <Link href="/onboarding/phone" className="text-[clamp(14px,2.6vw,20px)] leading-none" style={{ color: SEGNA_BROWN }}>
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
        className="mt-10 space-y-10"
      >
        <OtpInput
          value={code}
          onChange={setCode}
          length={OTP_LENGTH}
          className="w-full !justify-between gap-[clamp(8px,2vw,16px)]"
          itemClassName="min-w-0 flex-1"
          placeholderChar="-"
          inputClassName="h-[clamp(54px,9vw,66px)] w-full min-w-0 text-[clamp(28px,7.2vw,48px)] font-bold playfair-display placeholder:text-zinc-900/70"
        />

        {errorMessage ? <p className="text-[20px] text-[#E44D3E]">{errorMessage}</p> : null}
        <p className="text-[clamp(14px,2.6vw,20px)] font-semibold" style={{ color: SEGNA_BROWN }}>
          Tu n&apos;as pas reçu le code ?
        </p>
      </form>
    </div>
  );
}
