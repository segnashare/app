import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type AppViewportProps = {
  children: ReactNode;
  className?: string;
};

export function AppViewport({ children, className }: AppViewportProps) {
  return (
    <main className="flex h-dvh min-h-[844px] w-full min-w-[390px] items-center justify-center bg-[#f9f9f8]">
      <div
        className={cn(
          "mx-auto flex aspect-[390/844] h-[min(100dvh,calc(100vw*844/390))] min-h-[844px] w-[min(100vw,calc(100dvh*390/844))] min-w-[390px] flex-col justify-between overflow-y-auto px-6 py-8 md:px-8 md:py-10",
          className,
        )}
      >
        {children}
      </div>
    </main>
  );
}
