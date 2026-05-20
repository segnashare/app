"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils/cn";

type StarRatingInputProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
};

export function StarRatingInput({ value, onChange, disabled = false, className }: StarRatingInputProps) {
  return (
    <div className={cn("flex items-center gap-1", className)} role="radiogroup" aria-label="Note sur 5">
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= value;
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} sur 5`}
            onClick={() => onChange(star)}
            className={cn(
              "rounded-full p-1 transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50",
              active ? "text-zinc-900" : "text-zinc-300",
            )}
          >
            <Star className={cn("h-8 w-8", active && "fill-current")} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
