import type { ReactNode } from "react";

import { PreCartExitPathTracker } from "@/components/cart/PreCartExitPathTracker";
import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { FloatingViewCartButton } from "@/components/layout/FloatingViewCartButton";
import { InAppOnboardingIntroModal } from "@/components/onboarding/InAppOnboardingIntroModal";
import { cn } from "@/lib/utils/cn";

type InAppOnboardingIntroGate = {
  userId: string;
  lastSignInAt: string | null;
};

type MainShellProps = {
  children: ReactNode;
  isDemoMode?: boolean;
  inAppOnboardingIntro?: InAppOnboardingIntroGate | null;
};

export function MainShell({
  children,
  isDemoMode = false,
  inAppOnboardingIntro = null,
}: MainShellProps) {
  return (
    <div className="min-h-[100dvh] bg-zinc-100 text-zinc-900">
      <div className="mx-auto min-h-[100dvh] w-full max-w-[430px] overflow-x-hidden bg-white md:my-6 md:min-h-[calc(100dvh-48px)] md:rounded-[32px] md:border md:border-zinc-200 md:shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
        <PreCartExitPathTracker />
        {isDemoMode ? (
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900">
            Mode demo: modifications et paiements desactives.
          </div>
        ) : null}
        <div className={cn("flex min-h-[100dvh] flex-col md:min-h-[calc(100dvh-48px)]")}>{children}</div>
      </div>
      <FloatingViewCartButton />
      <BottomTabBar />
      {inAppOnboardingIntro ? (
        <InAppOnboardingIntroModal
          userId={inAppOnboardingIntro.userId}
          lastSignInAt={inAppOnboardingIntro.lastSignInAt}
        />
      ) : null}
    </div>
  );
}
