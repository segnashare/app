import type { ReactNode } from "react";

import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { cn } from "@/lib/utils/cn";

type MainShellProps = {
  children: ReactNode;
};

export function MainShell({ children }: MainShellProps) {
  return (
    <div className="min-h-[100dvh] bg-[#f5f3f0] text-zinc-900">
      <div className="mx-auto min-h-[100dvh] w-full max-w-[430px] bg-white md:my-6 md:min-h-[calc(100dvh-48px)] md:rounded-[32px] md:border md:border-zinc-200 md:shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
        <div className={cn("flex min-h-[100dvh] flex-col md:min-h-[calc(100dvh-48px)]")}>{children}</div>
      </div>
      <BottomTabBar />
    </div>
  );
}
