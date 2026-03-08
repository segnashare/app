"use client";

import { Montserrat } from "next/font/google";
import { Image as ImageIcon, Lightbulb, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type OnboardingLooksCoreProps = {
  formId: string;
  onCanContinueChange?: (value: boolean) => void;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "600",
});

export function OnboardingLooksCore({ formId, onCanContinueChange }: OnboardingLooksCoreProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeSlotRef = useRef(0);

  const [slots, setSlots] = useState<Array<string | null>>([null, null, null]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedCount = slots.filter(Boolean).length;
  const canContinue = !isSubmitting;

  useEffect(() => {
    onCanContinueChange?.(canContinue);
  }, [canContinue, onCanContinueChange]);

  const openPickerForSlot = (index: number) => {
    activeSlotRef.current = index;
    fileInputRef.current?.click();
  };

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    const slotIndex = activeSlotRef.current;
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = previewUrl;
      return next;
    });
    event.target.value = "";
  };

  const onDropSlot = (targetIndex: number) => {
    if (draggingIndex === null || draggingIndex === targetIndex) return;
    setSlots((prev) => {
      const next = [...prev];
      const temp = next[targetIndex];
      next[targetIndex] = next[draggingIndex];
      next[draggingIndex] = temp;
      return next;
    });
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    setIsSubmitting(true);
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_current_step: "/onboarding/answers",
      p_progress: {
        checkpoint: "/onboarding/looks",
        looks_count: selectedCount,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/onboarding/answers");
  };

  return (
    <div className="mt-7 w-full">
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5">
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />

        <div className="grid grid-cols-3 gap-2">
          {slots.map((slot, index) => (
            <button
              key={`look-slot-${index}`}
              type="button"
              draggable={Boolean(slot)}
              onDragStart={() => setDraggingIndex(index)}
              onDragEnd={() => {
                setDraggingIndex(null);
                setDragOverIndex(null);
              }}
              onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
              onDragEnter={() => setDragOverIndex(index)}
              onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
              onDrop={() => onDropSlot(index)}
              onClick={() => openPickerForSlot(index)}
              className={cn(
                "relative aspect-[3/5] overflow-hidden rounded-2xl border-2 border-dashed bg-[#f7f3ef] transition",
                dragOverIndex === index ? "border-[#5E3023] bg-[#f3ece5]" : "border-[#5E3023]/55",
              )}
            >
              {slot ? (
                <img src={slot} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="relative inline-flex items-center justify-center">
                    <ImageIcon size={32} className="text-zinc-400" />
                    <span className="absolute -bottom-2 -right-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#5E3023] text-white">
                      <Plus size={14} strokeWidth={3} />
                    </span>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>

        <div>
          <p className={cn(montserrat.className, "text-[clamp(12px,2.2vw,14px)] italic text-[#b3b3b3]")}>Fais glisser pour réorganiser</p>
          <p className={cn(montserrat.className, "text-[clamp(14px,2.8vw,20px)] font-semibold leading-none text-[#5E3023]")}>Ajoute 1 à 3 photos</p>
        </div>

        <div className="relative rounded-[14px] border border-zinc-200 bg-transparent px-4 pb-4 pt-6">
          <div className="absolute -top-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center justify-center rounded-full bg-[#f9f9f8] p-1">
            <Lightbulb className="h-5 w-5 text-zinc-500" strokeWidth={1.8} aria-hidden />
          </div>
          <p className={cn(montserrat.className, "text-center text-[clamp(14px,2.7vw,22px)] leading-[1.1] text-zinc-900")}>
            Ajoute 3 looks type OOTD où l&apos;on te voit <span className="text-[#5E3023]">seule avec ta tenue.</span>
          </p>
        </div>
      </form>

      {errorMessage ? <p className="mt-3 text-[clamp(12px,4.2vw,18px)] text-[#E44D3E]">{errorMessage}</p> : null}

    </div>
  );
}
