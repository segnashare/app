import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type SubflowShellProps = {
  children: ReactNode;
};

export function SubflowShell({ children }: SubflowShellProps) {
  return (
    <div className="min-h-[100dvh] w-full bg-white text-zinc-900">
      <div className="mx-auto min-h-[100dvh] w-full max-w-[430px] overflow-hidden bg-white md:my-6 md:min-h-[calc(100dvh-48px)] md:rounded-[32px] md:border md:border-zinc-200 md:shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
        <div className={cn("flex min-h-[100dvh] flex-col md:min-h-[calc(100dvh-48px)]")}>{children}</div>
      </div>
    </div>
  );
}
