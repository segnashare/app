"use client";

import { Montserrat } from "next/font/google";
import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { themeClassNames } from "@/styles/theme";

type OnboardingAnswersCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});
const montserratItalic = Montserrat({
  subsets: ["latin"],
  weight: "500",
  style: "italic",
});
const montserratExtraBoldItalic = Montserrat({
  subsets: ["latin"],
  weight: "700",
  style: "italic",
});

type AnswerFieldProps = {
  prompt: string;
  response: string;
  placeholder: string;
  onChangeResponse: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onOpenPrompt: () => void;
};

function AnswerField({ prompt, response, placeholder, onChangeResponse, textareaRef, onOpenPrompt }: AnswerFieldProps) {
  const hasPrompt = prompt.trim().length > 0;
  return (
    <div className="relative w-full rounded-[11px] border-2 border-dashed border-[#c6c6c6] bg-transparent px-4 pb-2 pt-2 text-left">
      {hasPrompt ? (
        <p
          className={cn(
            montserratExtraBoldItalic.className,
            "min-h-[34px] pr-10 text-[clamp(18px,2.8vw,24px)] font-extrabold italic leading-[1.08] tracking-[0.01em] text-zinc-900",
          )}
        >
          {prompt}
        </p>
      ) : null}

      <textarea
        ref={textareaRef}
        value={response}
        onChange={(event) => onChangeResponse(event.target.value)}
        readOnly={!hasPrompt}
        rows={2}
        placeholder={hasPrompt ? "Appuie pour répondre" : placeholder}
        className={cn(
          montserratItalic.className,
          "mt-1 min-h-[34px] w-full resize-none bg-transparent pr-10 text-[clamp(16px,2.8vw,22px)] leading-[1.08] tracking-[0.01em] outline-none",
          hasPrompt ? "text-zinc-900 placeholder:text-[#c2c2c2]" : "text-[#c2c2c2] placeholder:text-[#c2c2c2]",
        )}
      />

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenPrompt();
        }}
        className="absolute right-[7px] top-[7px] inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#5E3023] text-white"
        aria-label="Choisir un prompt"
      >
        <Plus size={16} strokeWidth={3} />
      </button>
    </div>
  );
}

export function OnboardingAnswersCore({ formId, onCanContinueChange }: OnboardingAnswersCoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();
  const answer0Ref = useRef<HTMLTextAreaElement | null>(null);
  const answer1Ref = useRef<HTMLTextAreaElement | null>(null);
  const answer2Ref = useRef<HTMLTextAreaElement | null>(null);

  const [prompt0, setPrompt0] = useState("");
  const [prompt1, setPrompt1] = useState("");
  const [prompt2, setPrompt2] = useState("");
  const [response0, setResponse0] = useState("");
  const [response1, setResponse1] = useState("");
  const [response2, setResponse2] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canContinue = !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  useEffect(() => {
    setPrompt0(searchParams.get("p0") ?? "");
    setPrompt1(searchParams.get("p1") ?? "");
    setPrompt2(searchParams.get("p2") ?? "");
    setResponse0(searchParams.get("r0") ?? "");
    setResponse1(searchParams.get("r1") ?? "");
    setResponse2(searchParams.get("r2") ?? "");
  }, [searchParams]);

  const openPromptPicker = (slot: 0 | 1 | 2) => {
    const params = new URLSearchParams();
    params.set("slot", String(slot));
    if (prompt0.trim()) params.set("p0", prompt0.trim());
    if (prompt1.trim()) params.set("p1", prompt1.trim());
    if (prompt2.trim()) params.set("p2", prompt2.trim());
    if (response0.trim()) params.set("r0", response0.trim());
    if (response1.trim()) params.set("r1", response1.trim());
    if (response2.trim()) params.set("r2", response2.trim());
    router.push(`/onboarding/answers/prompts?${params.toString()}`);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/subscription",
      p_progress: {
        checkpoint: "/onboarding/answers",
        answers_value: {
          answer_1: { prompt: prompt0.trim(), response: response0.trim() },
          answer_2: { prompt: prompt1.trim(), response: response1.trim() },
          answer_3: { prompt: prompt2.trim(), response: response2.trim() },
        },
      },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/subscription");
  };

  return (
    <div className="mt-7 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-3">
        <div onClick={() => prompt0.trim() && answer0Ref.current?.focus()}>
          <AnswerField
            prompt={prompt0}
            response={response0}
            placeholder="Partage ton inspi"
            onChangeResponse={setResponse0}
            textareaRef={answer0Ref}
            onOpenPrompt={() => openPromptPicker(0)}
          />
        </div>
        <div onClick={() => prompt1.trim() && answer1Ref.current?.focus()}>
          <AnswerField
            prompt={prompt1}
            response={response1}
            placeholder="Partage ton style"
            onChangeResponse={setResponse1}
            textareaRef={answer1Ref}
            onOpenPrompt={() => openPromptPicker(1)}
          />
        </div>
        <div onClick={() => prompt2.trim() && answer2Ref.current?.focus()}>
          <AnswerField
            prompt={prompt2}
            response={response2}
            placeholder="Partage ton univers"
            onChangeResponse={setResponse2}
            textareaRef={answer2Ref}
            onOpenPrompt={() => openPromptPicker(2)}
          />
        </div>

        <p className={cn(montserrat.className, "pt-2 text-[clamp(14px,2.8vw,20px)] font-semibold text-[#5E3023]")}></p>
      </form>

      {errorMessage ? <p className={cn("mt-3", themeClassNames.onboarding.textes.erreurFormulaire)}>{errorMessage}</p> : null}
    </div>
  );
}
