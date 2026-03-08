"use client";

import { Montserrat } from "next/font/google";
import { Plus } from "lucide-react";
import type { RefObject } from "react";

import { cn } from "@/lib/utils/cn";

type StyleAdditionalInputProps = {
  value: string;
  onChange: (value: string) => void;
  onAddClick?: () => void;
  placeholder?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  rows?: number;
  containerClassName?: string;
  textareaClassName?: string;
};

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: "500",
  style: "italic",
});

export function StyleAdditionalInput({
  value,
  onChange,
  onAddClick,
  placeholder = "Dis-nous en plus sur ton style avec tes mots à toi",
  textareaRef,
  rows = 2,
  containerClassName,
  textareaClassName,
}: StyleAdditionalInputProps) {
  return (
    <div className={cn("relative rounded-[11px] border-2 border-dashed border-[#aaaaaa] bg-white/20 px-4 pb-3 pt-3", containerClassName)}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={cn(
          montserrat.className,
          "w-full resize-none bg-transparent pr-10 text-[clamp(16px,3.2vw,23px)] leading-[1.05] tracking-[0.01em] text-zinc-900/90 outline-none placeholder:text-[#ababab]",
          textareaClassName,
        )}
      />
      <button
        type="button"
        className="absolute right-[7px] top-[7px] inline-flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#5E3023] text-white"
        onClick={onAddClick}
        aria-label="Ajouter un style"
      >
        <Plus size={16} strokeWidth={3} />
      </button>
    </div>
  );
}
