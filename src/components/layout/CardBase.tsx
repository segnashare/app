import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type CardBaseProps = {
  children: ReactNode;
  className?: string;
};

export function CardBase({ children, className }: CardBaseProps) {
  return <article className={cn("rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm", className)}>{children}</article>;
}
