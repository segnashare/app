"use client";

import { Montserrat } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, WheelEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type OnboardingSizeCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

type WheelPickerProps = {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

const TOP_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];
const BOTTOM_OPTIONS = ["32", "34", "36", "38", "40", "42", "44", "46", "48"];
const SHOES_OPTIONS = Array.from({ length: 16 }, (_, i) => String(30 + i));
const WHEEL_STEP_THRESHOLD = 120;
const WHEEL_COOLDOWN_MS = 140;

function getWrapped(options: string[], index: number) {
  const total = options.length;
  return options[((index % total) + total) % total];
}

function WheelPicker({ label, options, value, onChange }: WheelPickerProps) {
  const currentIndex = Math.max(0, options.indexOf(value));
  const prev = getWrapped(options, currentIndex - 1);
  const next = getWrapped(options, currentIndex + 1);
  const wheelContainerRef = useRef<HTMLDivElement | null>(null);
  const wheelDeltaAccumulatorRef = useRef(0);
  const lastWheelStepAtRef = useRef(0);

  const step = (delta: number) => {
    onChange(getWrapped(options, currentIndex + delta));
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const now = Date.now();
    if (now - lastWheelStepAtRef.current < WHEEL_COOLDOWN_MS) return;

    wheelDeltaAccumulatorRef.current += event.deltaY;
    const absDelta = Math.abs(wheelDeltaAccumulatorRef.current);

    if (absDelta < WHEEL_STEP_THRESHOLD) return;

    const direction = wheelDeltaAccumulatorRef.current > 0 ? 1 : -1;
    step(direction);
    lastWheelStepAtRef.current = now;
    wheelDeltaAccumulatorRef.current = 0;
  };

  useEffect(() => {
    const element = wheelContainerRef.current;
    if (!element) return;

    const onWheelNative = (event: WheelEvent) => {
      handleWheel(event as unknown as WheelEvent<HTMLDivElement>);
    };

    element.addEventListener("wheel", onWheelNative, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheelNative);
    };
  });

  return (
    <div className="border-b border-zinc-300 pb-2 pt-1">
      <p className={cn(montserrat.className, "mb-1 text-[clamp(14px,2.2vw,18px)] italic leading-none text-[#b0b0b0]")}>{label}</p>

      <div
        ref={wheelContainerRef}
        className="select-none"
      >
        <button type="button" className="flex w-full justify-center py-[2px]" onClick={() => step(-1)}>
          <span className={cn(montserrat.className, "text-[clamp(20px,3.8vw,28px)] font-semibold leading-none text-zinc-400")}>{prev}</span>
        </button>

        <button
          type="button"
          className="flex w-full justify-center border-y border-zinc-700 bg-zinc-100/65 py-[6px]"
          onClick={() => step(1)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") step(1);
            if (event.key === "ArrowUp") step(-1);
          }}
        >
          <span className={cn(montserrat.className, "text-[clamp(24px,4.4vw,34px)] font-semibold leading-none text-zinc-800")}>{value}</span>
        </button>

        <button type="button" className="flex w-full justify-center py-[2px]" onClick={() => step(1)}>
          <span className={cn(montserrat.className, "text-[clamp(20px,3.8vw,28px)] font-semibold leading-none text-zinc-400")}>{next}</span>
        </button>
      </div>
    </div>
  );
}

export function OnboardingSizeCore({ formId, onCanContinueChange }: OnboardingSizeCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const initialTop = useMemo(() => TOP_OPTIONS[Math.floor(TOP_OPTIONS.length / 2)], []);
  const initialBottom = useMemo(() => BOTTOM_OPTIONS[Math.floor(BOTTOM_OPTIONS.length / 2)], []);
  const initialShoes = useMemo(() => SHOES_OPTIONS[Math.floor(SHOES_OPTIONS.length / 2)], []);

  const [topSize, setTopSize] = useState(initialTop);
  const [bottomSize, setBottomSize] = useState(initialBottom);
  const [shoesSize, setShoesSize] = useState(initialShoes);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canContinue = Boolean(topSize && bottomSize && shoesSize) && !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    setIsSubmitting(true);
    const { error: sizesError } = await supabase.rpc("set_user_profile_sizes", {
      p_top_size_code: `top:${topSize}`,
      p_bottom_size_code: `bottom:${bottomSize}`,
      p_shoes_size_code: `shoes:${shoesSize}`,
      p_request_id: crypto.randomUUID(),
    });
    if (sizesError) {
      setIsSubmitting(false);
      setErrorMessage(sizesError.message);
      return;
    }

    const { error } = await supabase.rpc("upsert_onboarding_progress", {
      p_current_step: "/onboarding/work",
      p_progress_json: {
        checkpoint: "/onboarding/size",
      },
      p_request_id: crypto.randomUUID(),
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/work");
  };

  return (
    <div className="mt-3 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-1">
        <WheelPicker label="Haut :" options={TOP_OPTIONS} value={topSize} onChange={setTopSize} />
        <WheelPicker label="Bas :" options={BOTTOM_OPTIONS} value={bottomSize} onChange={setBottomSize} />
        <WheelPicker label="Chaussures :" options={SHOES_OPTIONS} value={shoesSize} onChange={setShoesSize} />
      </form>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
