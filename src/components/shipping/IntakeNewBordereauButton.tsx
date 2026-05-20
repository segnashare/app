"use client";

import { segnaMontserrat } from "@/lib/ui/segna-webfonts";
import { cn } from "@/lib/utils/cn";

const montserrat = segnaMontserrat;

export type IntakeNewBordereauButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  shimmer?: boolean;
  variant?: "outline" | "primary";
  className?: string;
};

export function IntakeNewBordereauButton({
  onClick,
  disabled = false,
  shimmer = false,
  variant = "outline",
  className,
}: IntakeNewBordereauButtonProps) {
  return (
    <div className={cn(shimmer && "segna-guidance-shimmer-active")}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          montserrat.className,
          "segna-guidance-shimmer-target relative z-0 flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
          variant === "primary"
            ? "bg-zinc-950 font-bold text-white shadow-sm hover:bg-zinc-900"
            : "border border-zinc-200 bg-white text-zinc-900",
          className,
        )}
      >
        Nouveau Bordereau
      </button>
    </div>
  );
}
