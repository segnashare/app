import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-500 focus:border-zinc-900",
        className,
      )}
      {...props}
    />
  );
}
