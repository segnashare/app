"use client";

import { cn } from "@/lib/utils/cn";

type NextArrowProps = {
  enabled: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
  form?: string;
};

export function NextArrow({ enabled, type = "button", onClick, className, ariaLabel = "Continuer", form }: NextArrowProps) {
  const nextArrowSrc = enabled ? "/ressources/icons/next_full.png" : "/ressources/icons/next_empty.png";

  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={!enabled}
      aria-label={ariaLabel}
      className={cn("h-[62px] w-[62px] shrink-0 disabled:cursor-not-allowed", className)}
    >
      <img src={nextArrowSrc} alt="" className="h-full w-full" />
    </button>
  );
}
