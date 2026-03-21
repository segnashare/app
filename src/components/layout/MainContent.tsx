import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type MainContentProps = {
  children: ReactNode;
  className?: string;
};

export function MainContent({ children, className }: MainContentProps) {
  return <main className={cn("flex-1 space-y-5 px-5 pb-28 pt-4", className)}>{children}</main>;
}
