import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-800",
        variant === "secondary" && "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100",
        variant === "ghost" && "text-zinc-700 hover:bg-zinc-100",
        className,
      )}
      {...props}
    />
  );
}
